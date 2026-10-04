import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { fixtureOffice, eventually } from './helpers/office.js';
import { mathProject, browserProject, localEngine } from './helpers/local-project.js';
import { Runner } from '../server/runner.js';
import { Store } from '../server/store.js';
import { LocalBrowserRuntime, runCommand, terminalQA } from '../server/local-verification.js';
import { openBrowserQA } from '../server/browser-qa.js';
import type { Task } from '../shared/types.js';

const headers = { 'x-agent-town': '1' };
async function post(office: Awaited<ReturnType<typeof fixtureOffice>>, projectPath: string, prompt: string) {
  const response = await office.app.inject({ method: 'POST', url: '/api/tasks', headers, payload: { prompt, mode: 'claude', access: 'local', projectPath } });
  assert.equal(response.statusCode, 200, response.body);
  const task = office.runner.tasks.find(task => task.id === response.json().id)!;
  await eventually(() => ['done', 'needs_attention'].includes(task.status), 45000);
  return task;
}

test('full-access folder picker resolves hidden and linked folders outside report workspaces', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-access-'));
  const simulation = localEngine(); const office = await fixtureOffice(root, simulation.engine);
  try {
    await mkdir(path.join(root, '.hidden')); await mkdir(path.join(root, 'external'));
    await symlink(path.join(root, 'external'), path.join(root, 'linked'));
    await writeFile(path.join(root, 'plain.txt'), 'file');
    const listing = await office.app.inject(`/api/directories?path=${encodeURIComponent(root)}`);
    assert.equal(listing.statusCode, 200);
    for (const name of ['.hidden', 'external', 'linked']) assert.ok(listing.json().entries.some((entry: { name: string }) => entry.name === name));
    assert.equal(listing.json().entries.some((entry: { name: string }) => entry.name === 'plain.txt'), false);
    const resolve = await office.app.inject(`/api/directories?path=${encodeURIComponent(path.join(root, 'linked'))}`);
    assert.equal(resolve.json().path, path.join(root, 'external'));
    assert.equal((await office.app.inject('/api/directories?path=/missing-agent-town-folder')).statusCode, 400);
    assert.equal((await office.app.inject({ url: '/api/directories', headers: { host: 'evil.example' } })).statusCode, 403);
    for (const projectPath of [path.join(root, 'plain.txt'), '/missing-agent-town-folder']) {
      const response = await office.app.inject({ method: 'POST', url: '/api/tasks', headers, payload: { prompt: 'daftar folder', mode: 'claude', access: 'local', projectPath } });
      assert.equal(response.statusCode, 400); assert.equal(office.runner.tasks.length, 0);
    }
    assert.equal(simulation.calls.length, 0);
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('an informational laptop request reads actual folders and completes with only CEO, including reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-answer-'));
  const project = await mathProject(root); const simulation = localEngine(); const office = await fixtureOffice(root, simulation.engine);
  try {
    const task = await post(office, project, 'Berikan daftar folder yang ada');
    assert.equal(task.status, 'done', task.error); assert.match(task.answer!, /lib/);
    assert.deepEqual(simulation.calls.map(call => call.role), ['ceo']);
    assert.ok(task.stages.filter(stage => stage.role !== 'ceo').every(stage => stage.status === 'skipped'));
    assert.equal(task.browserEvidence?.length || 0, 0); assert.equal(task.projectPath, project);
    const store = new Store(path.join(root, 'office.sqlite'));
    const restored = new Runner(store, path.join(root, 'projects'), () => {}, simulation.engine);
    assert.equal(restored.tasks.find(item => item.id === task.id)?.status, 'done');
    assert.equal(restored.tasks.find(item => item.id === task.id)?.answer, task.answer);
    await restored.shutdown(); store.close();
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('existing files are edited in place and verified by real terminal execution; full-path files can be viewed and downloaded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-edit-'));
  const project = await mathProject(root); const simulation = localEngine(); const office = await fixtureOffice(root, simulation.engine);
  try {
    const task = await post(office, project, 'Perbaiki double di project yang ada');
    assert.equal(task.status, 'done', task.error);
    assert.match(await readFile(path.join(project, 'lib/math.mjs'), 'utf8'), /n \* 2/);
    assert.match(await readFile(path.join(project, 'README.md'), 'utf8'), /Existing project conventions/);
    assert.ok(task.terminalEvidence?.every(item => item.passed)); assert.match(task.terminalEvidence![0].detail, /double verified/);
    assert.deepEqual(simulation.calls.map(call => `${call.role}:${call.phase}`), ['ceo:work', 'pm:work', 'frontend:work', 'qa:prepare', 'qa:review']);
    assert.ok(simulation.calls.every(call => call.project === project));
    assert.equal(task.files.some(file => file.path === 'lib/math.mjs' || file.path === 'index.html'), false);
    assert.equal(task.changedFiles![0].path, path.join(project, 'lib/math.mjs'));
    await writeFile(path.join(root, '.outside.txt'), 'Outside starting folder is allowed.');
    const file = await office.app.inject(`/api/tasks/${task.id}/project-file?path=${encodeURIComponent('../.outside.txt')}`);
    assert.equal(file.statusCode, 200); assert.match(file.json().content, /Outside/);
    const download = await office.app.inject(`/api/tasks/${task.id}/project-download?path=${encodeURIComponent(path.join(project, 'lib/math.mjs'))}`);
    assert.equal(download.statusCode, 200); assert.match(download.body, /n \* 2/);
    assert.match(String(download.headers['content-disposition']), /math.mjs/);
    assert.equal((await office.app.inject(`/api/tasks/${task.id}/preview`)).statusCode, 404);
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed terminal evidence cannot be overridden by an AI pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-terminal-fail-'));
  const project = await mathProject(root); const simulation = localEngine({ broken: true });
  const office = await fixtureOffice(root, async request => { request.task.revisionLimit = 1; return simulation.engine(request); });
  try {
    const task = await post(office, project, 'Perbaiki double dengan bukti nyata');
    assert.equal(task.status, 'needs_attention'); assert.equal(task.retry, 1);
    assert.equal(task.terminalEvidence![0].passed, false); assert.match(task.terminalEvidence![0].detail, /AssertionError/);
    assert.ok(task.checks.some(check => !check.passed));
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('existing web project runs its own server, gets live browser QA and preserves preview origin on reopen', { timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-native-browser-'));
  const project = await browserProject(root); const simulation = localEngine({ browser: true }); const office = await fixtureOffice(root, simulation.engine);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  try {
    const task = await post(office, project, 'Perbaiki counter di aplikasi web ini');
    assert.equal(task.status, 'done', task.error);
    assert.ok(task.browserEvidence?.every(item => item.passed));
    assert.ok(task.files.some(file => /case-1.png$/.test(file.path)));
    assert.equal(task.files.some(file => file.path === 'index.html'), false);
    const open = await office.app.inject(`/api/tasks/${task.id}/preview`);
    assert.equal(open.statusCode, 200, open.body); const firstURL = open.json().url;
    assert.ok(firstURL.endsWith('/dashboard'));
    const page = await browser.newPage(); await page.goto(firstURL);
    await page.getByRole('button', { name: 'Tambah' }).click();
    assert.equal(await page.locator('#count').innerText(), '1');
    await page.evaluate(() => localStorage.setItem('preview-kept', 'yes'));
    await office.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/close-preview`, headers, payload: {} });
    await assert.rejects(fetch(firstURL, { signal: AbortSignal.timeout(2000) }));
    const reopened = await office.app.inject(`/api/tasks/${task.id}/preview`);
    assert.equal(reopened.json().url, firstURL); await page.goto(firstURL);
    assert.equal(await page.evaluate(() => localStorage.getItem('preview-kept')), 'yes');
    await office.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/close-preview`, headers, payload: {} });
    await assert.rejects(fetch(firstURL, { signal: AbortSignal.timeout(2000) }));
  } finally { await browser.close(); await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('a native server code defect goes through its engineer and full browser regression before ready', { timeout: 45000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-startup-repair-'));
  const project = await browserProject(root); const original = await readFile(path.join(project, 'server.mjs'), 'utf8');
  const simulation = localEngine({ browser: true }); let frontendCalls = 0;
  const office = await fixtureOffice(root, async request => {
    const result = await simulation.engine(request);
    if (request.role === 'frontend') {
      await writeFile(path.join(project, 'server.mjs'), ++frontendCalls === 1 ? 'invalid JavaScript !' : original);
      result.output.changedFiles!.push('server.mjs');
    }
    if (request.role === 'qa' && request.phase === 'review' && request.task.checks.some(check => !check.passed)) {
      assert.match(request.context, /Server project gagal mulai/);
      result.output.verdict = 'revise'; result.output.findings = [{ role: 'frontend', summary: 'Syntax server rusak', reproduction: 'node server.mjs', expected: 'Server mulai', actual: 'SyntaxError' }];
    }
    return result;
  });
  try {
    const task = await post(office, project, 'Perbaiki counter dan server project yang ada');
    assert.equal(task.status, 'done', task.error); assert.equal(frontendCalls, 2); assert.equal(task.retry, 1);
    assert.ok(task.browserEvidence?.every(item => item.passed));
    assert.ok(task.checks.every(check => check.passed));
    assert.deepEqual(task.findings, []);
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('QA repairs a bad native server command without revising correct application code', { timeout: 45000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-server-command-'));
  const project = await browserProject(root); const simulation = localEngine({ browser: true });
  const office = await fixtureOffice(root, async request => {
    const result = await simulation.engine(request);
    if (request.role === 'qa' && request.phase === 'prepare' && request.task.retry === 0) result.output.localVerification!.serverCommand = 'node nonexistent-server.mjs';
    if (request.role === 'qa' && request.phase === 'review' && request.task.checks.some(check => !check.passed)) {
      result.output.verdict = 'revise'; result.output.findings = [{ role: 'qa', summary: 'Server command salah', reproduction: 'node nonexistent-server.mjs', expected: 'Gunakan server.mjs', actual: 'MODULE_NOT_FOUND' }];
    }
    return result;
  });
  try {
    const task = await post(office, project, 'Perbaiki counter dengan browser QA');
    assert.equal(task.status, 'done', task.error); assert.equal(task.retry, 1);
    assert.equal(simulation.calls.filter(call => call.role === 'frontend').length, 1);
    assert.equal(task.localVerification?.serverCommand, 'node server.mjs');
    assert.ok(task.browserEvidence?.every(item => item.passed));
  } finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
});

test('terminal stop waits for an uncooperative process to die and terminal-only QA rejects motion coverage', { timeout: 10000 }, async () => {
  const controller = new AbortController(); let pid = 0;
  try {
    await assert.rejects(runCommand('exec node -e \'process.on("SIGTERM",()=>{});console.log(process.pid);setInterval(()=>{},100)\'', os.tmpdir(), controller.signal, value => { pid = Number(value.trim()); controller.abort(); }), /dihentikan/);
    assert.ok(pid > 0); assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
    const task = { criteria: [{ id: 'motion', category: 'motion' }], localVerification: { kind: 'terminal', terminalTests: [{ id: 'fake', criterionId: 'motion', command: 'true', title: 'No browser' }] } } as Task;
    await assert.rejects(terminalQA(task, new AbortController().signal, () => {}), /wajib diuji di browser/);
  } finally { if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} } }
});

test('aborting browser QA waits for its owned server to exit, while attached servers remain running', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-browser-stop-'));
  const project = await browserProject(root);
  const serverFile = path.join(project, 'server.mjs');
  await writeFile(serverFile, (await readFile(serverFile, 'utf8')) + 'import {writeFileSync} from "node:fs";writeFileSync(new URL("./owned-pid.txt",import.meta.url),String(process.pid));process.on("SIGTERM",()=>{});\n');
  const controller = new AbortController();
  const task = { access: 'local', projectPath: project, workspace: root, localVerification: { kind: 'browser', serverCommand: 'node server.mjs', url: 'http://127.0.0.1:{port}/dashboard' } } as Task;
  const attachedServer = createServer((_req, res) => res.end('Existing user data'));
  let pid = 0;
  try {
    const session = await openBrowserQA(task, controller.signal, () => {});
    pid = Number(await readFile(path.join(project, 'owned-pid.txt'), 'utf8'));
    controller.abort(); await session.close();
    assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
    await new Promise<void>(resolve => attachedServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(attachedServer.address() as { port: number }).port}`;
    const attached = new LocalBrowserRuntime({ ...task, localVerification: { kind: 'browser', url } }, new AbortController().signal, () => {});
    await attached.start(); await attached.resetTestData(); await attached.stop();
    assert.equal(await (await fetch(url)).text(), 'Existing user data');
  } finally {
    controller.abort(); if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    await new Promise<void>(resolve => attachedServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
