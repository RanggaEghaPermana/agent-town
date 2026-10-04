import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Runner } from '../server/runner.js';
import { safePath, saveFiles, ensureSafePath, buildPreview } from '../server/files.js';
import type { AskEngine } from '../server/engine.js';
import type { OpenBrowser } from '../server/browser-qa.js';
import type { Task } from '../shared/types.js';
import { LocalBrowserRuntime, LocalProjectRuntimeError } from '../server/local-verification.js';

const html = '<!doctype html><html><head><title>Test</title><meta name="viewport" content="width=device-width"></head><body><button id="hi">Hi</button><script>document.getElementById("hi").onclick=()=>{document.body.dataset.clicked="yes"};</script></body></html>';
const fixture: AskEngine = async ({ role, phase }) => ({ output: {
  summary: `${role} selesai`, markdown: `${role} report`, files: role === 'frontend' ? [{ path: 'index.html', content: html }] : [], verdict: role === 'qa' && phase === 'review' ? 'pass' : 'none', issues: [], questions: [],
  ...(role === 'ceo' ? {plan: {needsBackend: false, needsDesign: true, complexity: 'clear' as const, reason: 'Small test'}} : {}),
  ...(role === 'pm' ? {criteria: [{id: 'hi', description: 'Greeting works', category: 'happy' as const}]} : {}),
  ...(role === 'qa' && phase === 'test-plan' ? {browserTests: [{id: 'hi', criterionId: 'hi', title: 'Greeting', steps: [{action: 'click' as const, selector: '#hi'}, {action: 'expectVisible' as const, selector: '#hi'}]}]} : {}),
}, inputTokens: 2, outputTokens: 3 });
const fixtureBrowser: OpenBrowser = async () => ({inspect: async () => 'Test DOM', run: async () => ({evidence: [{id:'hi', criterionId:'hi', title:'Greeting', passed:true, detail:'fixture', steps: [{action:'click', passed:true, detail:'fixture'}]}], checks: [{name:'browser fixture', passed:true, detail:'fixture'}], images: []}), close: async () => {}});
async function waitFor(check: () => boolean) {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > 10000) throw new Error('Timed out waiting for task'); await new Promise(resolve => setTimeout(resolve, 15)); }
}
async function setup(engine: AskEngine = fixture, browser: OpenBrowser = fixtureBrowser) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-test-'));
  const store = new Store(path.join(root, 'db.sqlite'));
  const runner = new Runner(store, path.join(root, 'projects'), () => {}, engine, engine, browser);
  runner.health = { installed: true, loggedIn: true, provider: 'test' };
  return { root, store, runner, cleanup: async () => { await runner.shutdown(); store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('all roles execute sequentially; real files and usage survive reload', async () => {
  const roles: string[] = [];
  const env = await setup(async request => { roles.push(request.role); return fixture(request); });
  try {
    const task = await env.runner.create('Build a simple greeting page', 'gpt');
    await waitFor(() => task.status === 'done' || task.status === 'needs_attention');
    assert.equal(task.status, 'done', task.error);
    assert.deepEqual(roles, ['ceo', 'pm', 'designer', 'frontend', 'qa', 'qa']);
    assert.equal(await readFile(path.join(task.workspace, 'index.html'), 'utf8'), html);
    assert.equal(task.inputTokens, 12); assert.equal(task.outputTokens, 18);
    assert.equal(task.stages.find(s => s.role === 'backend')?.status, 'skipped');
    assert.equal(task.usage?.length, 6);
    assert.equal(env.store.all()[0].status, 'done');
    assert.ok(task.checks.every(c => c.passed));
  } finally { await env.cleanup(); }
});

test('pause waits for active stage; resume continues the next role', async () => {
  let release: () => void = () => {}, ceoStarted = false;
  const env = await setup(async request => {
    if (request.role === 'ceo') { ceoStarted = true; await new Promise<void>(resolve => { release = resolve; }); }
    return fixture(request);
  });
  try {
    const task = await env.runner.create('Pause a small task', 'gpt');
    await waitFor(() => ceoStarted);
    env.runner.action(task.id, 'pause'); release();
    await waitFor(() => task.status === 'paused');
    assert.equal(task.stages[0].status, 'done'); assert.equal(task.stages[1].status, 'waiting');
    env.runner.action(task.id, 'resume');
    await waitFor(() => task.status === 'done');
  } finally { await env.cleanup(); }
});

test('stop aborts the engine and prevents later file writes', async () => {
  let called = false;
  const env = await setup(async request => {
    called = true;
    await new Promise<void>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return fixture(request);
  });
  try {
    const task = await env.runner.create('Stop this running task', 'gpt');
    await waitFor(() => called);
    env.runner.action(task.id, 'stop');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(task.status, 'stopped');
    assert.deepEqual(task.files.map(f => f.path), ['BRIEF.md', 'TEAM-RULES.md', 'CONVENTIONS.md', 'DESIGN-SYSTEM.md']);
    assert.equal(task.stages[1].status, 'waiting');
  } finally { await env.cleanup(); }
});

test('one worker handles queued tasks; a stopped queued task is not run', async () => {
  let release: () => void = () => {}, entered = false;
  const ids = new Set<string>();
  const env = await setup(async request => {
    ids.add(request.task.id);
    if (!entered) { entered = true; await new Promise<void>(resolve => { release = resolve; }); }
    return fixture(request);
  });
  try {
    const first = await env.runner.create('First greeting page', 'gpt');
    await waitFor(() => entered);
    const second = await env.runner.create('Second greeting page', 'gpt');
    assert.equal(second.status, 'queued');
    env.runner.action(second.id, 'stop'); release();
    await waitFor(() => first.status === 'done');
    assert.equal(ids.size, 1); assert.equal(second.status, 'stopped');
  } finally { await env.cleanup(); }
});

test('QA failures never become done; revision loop is bounded', async () => {
  let programmers = 0;
  const env = await setup(async request => {
    if (request.role === 'frontend') programmers++;
    const result = await fixture(request);
    if (request.role === 'qa') result.output = { ...result.output, verdict: 'revise', issues: ['Acceptance defect'], findings: [{role:'frontend',summary:'Acceptance defect',reproduction:'Click fails',expected:'Works',actual:'Broken'}] };
    return result;
  });
  try {
    const task = await env.runner.create('Task that fails acceptance review', 'gpt');
    await waitFor(() => task.status === 'needs_attention');
    assert.equal(programmers, 7); assert.equal(task.retry, 6);
    assert.equal(task.usage?.filter(item => item.role === 'frontend').at(-1)?.model, 'gpt-6-astra');
    assert.equal(task.stages.find(stage => stage.role === 'qa')?.status, 'failed');
    assert.match(task.error!, /Acceptance defect/);
  } finally { await env.cleanup(); }
});

test('restart ends interrupted work instead of replaying paid calls', async () => {
  const env = await setup();
  try {
    const now = new Date().toISOString();
    const task: Task = { id: 'interrupted', title: 'Interrupted', prompt: 'test', mode: 'gpt', status: 'running', stages: [{ role: 'ceo', status: 'working' }], logs: [], files: [], checks: [], createdAt: now, updatedAt: now, workspace: env.root, inputTokens: 0, outputTokens: 0, retry: 0 };
    env.store.save(task);
    const restored = new Runner(env.store, env.root, () => {});
    assert.equal(restored.tasks.find(t => t.id === task.id)?.status, 'stopped');
    assert.equal(restored.tasks.find(t => t.id === task.id)?.stages[0].status, 'failed');
  } finally { await env.cleanup(); }
});

test('restart removes cache reads from budgets recorded by earlier builds', async () => {
  const env = await setup();
  try {
    const now = new Date().toISOString();
    const record = { role: 'ceo' as const, phase: 'work', model: 'gpt-6.1-sol' as const, effort: 'low' as const, reason: 'test', inputTokens: 100, outputTokens: 5, cacheReadTokens: 80, cacheWriteTokens: 15, durationMs: 1, retry: 0 };
    const task: Task = { id: 'legacy-usage', title: 'Legacy', prompt: 'test', mode: 'gpt', status: 'needs_attention', stages: [{ role: 'ceo', status: 'done' }], logs: [], files: [], checks: [], createdAt: now, updatedAt: now, workspace: env.root, inputTokens: 200, outputTokens: 10, retry: 0, usage: [record, { ...record }] };
    env.store.save(task);
    new Runner(env.store, env.root, () => {});
    const restored = new Runner(env.store, env.root, () => {}).tasks.find(t => t.id === task.id)!;
    assert.equal(restored.inputTokens, 40); assert.equal(restored.outputTokens, 10);
    assert.deepEqual(restored.usage?.map(item => item.inputTokens), [20, 20]);
  } finally { await env.cleanup(); }
});

test('a browser check goes from CEO to live QA, waits for a manual login and never edits code', async () => {
  const calls: string[] = [];
  const env = await setup(async request => {
    calls.push(`${request.role}:${request.phase}`);
    const base = { summary: 'ok', markdown: `${request.role} report`, files: [], verdict: 'none' as const, issues: [], questions: [] };
    if (request.role === 'ceo') return { output: { ...base, plan: { kind: 'verify' as const, needsBackend: false, needsDesign: false, complexity: 'clear' as const, reason: 'Cek login' }, criteria: [{ id: 'login', description: 'Login berhasil', category: 'happy' as const }] }, inputTokens: 1, outputTokens: 1 };
    const loggedIn = request.context.includes('Sudah, lanjutkan');
    return { output: { ...base, verdict: loggedIn ? 'pass' as const : 'none' as const, findings: [], questions: loggedIn ? [] : [{ id: 'login', question: 'Login manual di tab yang terbuka', options: ['Sudah, lanjutkan'] }], liveEvidence: loggedIn ? [{ id: 'login', criterionId: 'login', title: 'Login', passed: true, detail: 'Dashboard tampil', steps: [{ action: 'navigate', passed: true, detail: 'ok' }] }] : [] }, inputTokens: 1, outputTokens: 1 };
  });
  try {
    const task = await env.runner.create('Cek login di prod', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => task.status === 'awaiting_input');
    env.runner.answer(task.id, task.clarifications![0].id, { login: 'Sudah, lanjutkan' });
    await waitFor(() => task.status === 'done');
    assert.deepEqual(calls, ['ceo:work', 'qa:live', 'qa:live']);
    assert.equal(task.answer, 'qa report'); assert.equal(task.browserEvidence?.[0].passed, true);
    assert.deepEqual(task.stages.filter(stage => stage.status === 'skipped').map(stage => stage.role), ['pm', 'designer', 'backend', 'frontend']);
  } finally { await env.cleanup(); }
});

test('a defect found in a browser check goes to its owner, whose question resumes the repair, then QA retests', async () => {
  const calls: string[] = [];
  let repaired = false;
  const env = await setup(async request => {
    calls.push(`${request.role}:${request.phase}`);
    const base = { summary: 'ok', markdown: `${request.role} report`, files: [], verdict: 'none' as const, issues: [], questions: [] };
    if (request.role === 'ceo') return { output: { ...base, plan: { kind: 'verify' as const, needsBackend: false, needsDesign: false, complexity: 'clear' as const, reason: 'Cek login' }, criteria: [{ id: 'login', description: 'Login berhasil', category: 'happy' as const }] }, inputTokens: 1, outputTokens: 1 };
    if (request.role === 'backend') {
      assert.match(request.context, /REPAIR:.*Restart or redeploy/s); assert.match(request.context, /API tidak merespons/); assert.equal(request.chrome, true);
      if (!request.context.includes('Sudah saya restart')) return { output: { ...base, questions: [{ id: 'ops', question: 'Layanan API mati; restart?', options: ['Sudah saya restart'] }] }, inputTokens: 1, outputTokens: 1 };
      repaired = true; return { output: base, inputTokens: 1, outputTokens: 1 };
    }
    if (repaired) assert.match(request.context, /YOUR PREVIOUS RUN.*Timeout/s);
    return { output: { ...base, verdict: repaired ? 'pass' as const : 'revise' as const, findings: repaired ? [] : [{ role: 'backend' as const, summary: 'API tidak merespons', reproduction: 'Klik Masuk', expected: 'Dashboard', actual: 'Timeout', fixInBrowser: true }], liveEvidence: [{ id: 'login', criterionId: 'login', title: 'Login', passed: repaired, detail: repaired ? 'Dashboard tampil' : 'Timeout', steps: [] }] }, inputTokens: 1, outputTokens: 1 };
  });
  try {
    const task = await env.runner.create('Cek login di prod', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => task.status === 'awaiting_input');
    assert.equal(task.clarifications![0].role, 'backend');
    env.runner.answer(task.id, task.clarifications![0].id, { ops: 'Sudah saya restart' });
    await waitFor(() => task.status === 'done');
    assert.deepEqual(calls, ['ceo:work', 'qa:live', 'backend:work', 'backend:work', 'qa:live']);
    assert.equal(task.answer, 'qa report'); assert.equal(task.retry, 1); assert.deepEqual(task.findings, []);
  } finally { await env.cleanup(); }
});

test('an operational task is led by its owner, who gets the browser only when the work needs it, and QA verifies', async () => {
  const calls: string[] = [];
  let plan = { kind: 'operate' as const, lead: 'backend' as const, browser: true, needsBackend: false, needsDesign: false, complexity: 'clear' as const, reason: 'Layanan mati' };
  const env = await setup(async request => {
    calls.push(`${request.role}:${request.phase}:${!!request.chrome}`);
    assert.equal(request.persist, request.role === 'backend' ? 'work' : request.role === 'ceo' ? 'question' : undefined);
    const base = { summary: 'ok', markdown: `${request.role} report`, files: [], verdict: 'none' as const, issues: [], questions: [] };
    if (request.role === 'ceo') return { output: { ...base, plan, criteria: [{ id: 'up', description: 'API merespons', category: 'happy' as const }] }, inputTokens: 1, outputTokens: 1 };
    if (request.role === 'backend') {
      assert.match(request.context, /LEAD THIS TASK/); assert.doesNotMatch(request.context, /FILE CONVENTIONS\.md/);
      return { output: { ...base, needsBrowser: !request.chrome }, inputTokens: 1, outputTokens: 1 };
    }
    return { output: { ...base, verdict: 'pass' as const, findings: [], liveEvidence: [{ id: 'up', criterionId: 'up', title: 'API', passed: true, detail: '200', steps: [] }] }, inputTokens: 1, outputTokens: 1 };
  });
  try {
    const planned = await env.runner.create('Hidupkan lagi API prod', 'gpt', undefined, { access: 'local', projectPath: env.root, nativeRoles: ['backend'] });
    await waitFor(() => planned.status === 'done');
    assert.deepEqual(planned.usage?.map(item => [item.role, !!item.native, !!item.chrome]), [['ceo', false, false], ['backend', true, true], ['qa', false, true]]);
    assert.deepEqual(calls, ['ceo:work:false', 'backend:work:true', 'qa:live:false']);
    assert.equal(planned.stages.find(stage => stage.role === 'backend')?.status, 'done'); assert.equal(planned.answer, 'qa report');
    calls.length = 0; plan = { ...plan, browser: false };
    const discovered = await env.runner.create('Hidupkan lagi API prod', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => discovered.status === 'done');
    assert.deepEqual(calls, ['ceo:work:false', 'backend:work:false', 'backend:work:true', 'qa:live:false']);
  } finally { await env.cleanup(); }
});

test('small clear work skips the requirements and preparation calls without losing verification', async () => {
  const calls: string[] = [];
  let supply = true;
  const env = await setup(async request => {
    calls.push(`${request.role}:${request.phase}`);
    const base = { summary: 'ok', markdown: `${request.role} report`, files: [], verdict: 'none' as const, issues: [], questions: [] };
    if (request.role === 'ceo') return { output: { ...base, plan: { kind: 'work' as const, needsBackend: false, needsDesign: false, complexity: 'clear' as const, reason: 'Ubah teks tombol' }, criteria: [{ id: 'teks', description: 'Tombol bertuliskan Keluar', category: 'happy' as const }] }, inputTokens: 1, outputTokens: 1 };
    if (request.role === 'frontend') { assert.match(request.context, /FILE PLAN\.md/); return { output: { ...base, changedFiles: [], ...(supply ? { localVerification: { kind: 'live' as const, url: 'http://127.0.0.1:9/index.html' } } : {}) }, inputTokens: 1, outputTokens: 1 }; }
    if (request.phase === 'prepare') return { output: { ...base, localVerification: { kind: 'live' as const, url: 'http://127.0.0.1:9/index.html' } }, inputTokens: 1, outputTokens: 1 };
    assert.match(request.context, /TARGET URL: http:\/\/127\.0\.0\.1:9\/index\.html/);
    return { output: { ...base, verdict: 'pass' as const, findings: [], liveEvidence: [{ id: 'teks', criterionId: 'teks', title: 'Teks', passed: true, detail: 'Keluar', steps: [] }] }, inputTokens: 1, outputTokens: 1 };
  });
  try {
    const task = await env.runner.create('Ubah teks tombol jadi Keluar', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => task.status === 'done');
    assert.deepEqual(calls, ['ceo:work', 'frontend:work', 'qa:live']);
    assert.equal(task.stages.find(stage => stage.role === 'pm')?.status, 'skipped'); assert.equal(task.browserEvidence?.[0].passed, true);
    calls.length = 0; supply = false;
    const fallback = await env.runner.create('Ubah teks tombol jadi Keluar', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => fallback.status === 'done');
    assert.deepEqual(calls, ['ceo:work', 'frontend:work', 'qa:prepare', 'qa:live']);
  } finally { await env.cleanup(); }
});

test('the verification URL accepts shell-style port placeholders and rejects an unusable URL as a runtime problem', { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-live-url-'));
  const task = (url: string, serverCommand?: string) => ({ projectPath: root, localVerification: { kind: 'live', url, serverCommand } }) as unknown as Task;
  try {
    const runtime = new LocalBrowserRuntime(task('http://127.0.0.1:$PORT/index.html', 'python3 -m http.server $PORT --bind 127.0.0.1'), new AbortController().signal, () => {});
    try { await runtime.start(); assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/); } finally { await runtime.stop(); }
    await assert.rejects(new LocalBrowserRuntime(task('bukan url'), new AbortController().signal, () => {}).start(), LocalProjectRuntimeError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a browser check that did not pass is never reported as finished', async () => {
  let fixed = false;
  const env = await setup(async request => {
    const base = { summary: 'ok', markdown: 'report', files: [], verdict: 'none' as const, issues: [], questions: [] };
    if (request.role === 'ceo') return { output: { ...base, plan: { kind: 'verify' as const, needsBackend: false, needsDesign: false, complexity: 'clear' as const, reason: 'Cek login' }, criteria: [{ id: 'login', description: 'Login berhasil', category: 'happy' as const }] }, inputTokens: 1, outputTokens: 1 };
    assert.match(request.context, /USER BRIEF: Cek login di prod/);
    return { output: { ...base, verdict: fixed ? 'pass' as const : 'revise' as const, findings: [], liveEvidence: [{ id: 'login', criterionId: 'login', title: 'Login', passed: fixed, detail: fixed ? 'Dashboard tampil' : 'Layar kosong', steps: [] }] }, inputTokens: 1, outputTokens: 1 };
  });
  try {
    const task = await env.runner.create('Cek login di prod', 'gpt', undefined, { access: 'local', projectPath: env.root });
    await waitFor(() => task.status === 'needs_attention');
    assert.match(task.error!, /belum lulus: login/); assert.equal(task.stages.find(stage => stage.role === 'qa')?.status, 'failed');
    fixed = true; env.runner.action(task.id, 'continue');
    await waitFor(() => task.status === 'done');
    assert.equal(task.stages.find(stage => stage.role === 'qa')?.status, 'done');
  } finally { await env.cleanup(); }
});

test('pasted images and follow-up messages reach the agents; invalid images are refused', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const seen: { images: number; context: string }[] = [];
  let pass = false;
  const env = await setup(async request => {
    seen.push({ images: request.images?.length || 0, context: request.context });
    const result = await fixture(request);
    return request.role === 'qa' && request.phase === 'review' && !pass ? { ...result, output: { ...result.output, verdict: 'revise' as const, findings: [{ role: 'qa' as const, summary: 'QA: ulang', reproduction: '-', expected: '-', actual: '-' }] } } : result;
  });
  try {
    await assert.rejects(env.runner.create('Tugas dengan gambar', 'gpt', undefined, { images: ['data:image/png;base64,aGVsbG8='] }), /PNG, JPEG atau WebP/);
    const task = await env.runner.create('Tugas dengan gambar', 'gpt', undefined, { images: [png] });
    task.revisionLimit = 0;
    await waitFor(() => task.status === 'needs_attention');
    assert.equal(task.attachments?.[0].path, 'attachments/1.png');
    assert.ok(seen.every(call => call.images >= 1 && call.context.includes('USER IMAGES: 1 image')));
    pass = true; seen.length = 0;
    env.runner.action(task.id, 'continue', { note: 'Pakai URL yang benar', images: [png] });
    await waitFor(() => task.status === 'done');
    assert.ok(seen.length && seen.every(call => call.images >= 2 && call.context.includes('Pakai URL yang benar')));
  } finally { await env.cleanup(); }
});

test('path traversal, hidden configuration and symlink writes are blocked', async () => {
  const env = await setup();
  try {
    for (const p of ['../outside.js', '/tmp/out.js', 'nested/../../out.js', '.claude/settings.json', 'x\\..\\out.js', 'malware.exe']) assert.throws(() => safePath(env.root, p));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agent-town-outside-'));
    try { await symlink(outside, path.join(env.root, 'linked')); await assert.rejects(ensureSafePath(env.root, 'linked/a.js'), /Symlink/); }
    finally { await rm(outside, { recursive: true, force: true }); }
    await assert.rejects(saveFiles(env.root, [{ path: 'okay.js', content: 'ok' }, { path: '../outside.js', content: 'bad' }], 'frontend'));
    await assert.rejects(readFile(path.join(env.root, 'okay.js')));
  } finally { await env.cleanup(); }
});

test('preview bundles only known local assets and disallows network access', async () => {
  const env = await setup();
  try {
    const files = await saveFiles(env.root, [{ path: 'index.html', content: '<html><head><title>T</title><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body></html>' }, { path: 'style.css', content: 'body{color:green}' }, { path: 'app.js', content: 'document.body.dataset.loaded="yes";' }], 'frontend');
    const preview = await buildPreview(env.root, files);
    assert.match(preview, /connect-src 'none'/); assert.match(preview, /body\{color:green\}/); assert.match(preview, /dataset.loaded/);
    assert.doesNotMatch(preview, /src="app.js"/);
  } finally { await env.cleanup(); }
});

test('ambiguity blocks dependent implementation, accepts answers, and frees the queue', async () => {
  const calls: string[] = [];
  const env = await setup(async request => {
    calls.push(`${request.task.prompt}:${request.role}`);
    const result = await fixture(request);
    if (request.task.prompt === 'Ambiguous storage task' && request.role === 'ceo' && !request.task.clarifications?.some(item => item.answers)) {
      result.output.questions = [{id: 'storage', question: 'Simpan di browser atau server?', options: ['Browser', 'Server']}];
    }
    return result;
  });
  try {
    const first = await env.runner.create('Ambiguous storage task', 'gpt');
    await waitFor(() => first.status === 'awaiting_input');
    assert.equal(first.files.some(file => file.path === 'index.html'), false);
    const second = await env.runner.create('Clear independent task', 'gpt');
    await waitFor(() => second.status === 'done');
    const question = first.clarifications![0];
    assert.throws(() => env.runner.answer(first.id, question.id, {storage: ''}));
    env.runner.answer(first.id, question.id, {storage: 'Browser'});
    assert.throws(() => env.runner.answer(first.id, question.id, {storage: 'Server'}));
    await waitFor(() => first.status === 'done');
    assert.equal(first.usage?.filter(item => item.role === 'ceo').length, 2);
    assert.equal(calls.filter(call => call === 'Ambiguous storage task:frontend').length, 1);
  } finally {await env.cleanup();}
});

test('an AI pass cannot override failed browser evidence or missing criteria coverage', async () => {
  const browser: OpenBrowser = async () => ({inspect: async () => '', run: async () => ({evidence: [], checks: [{name: 'Broken button', passed:false, detail:'Click produced no result'}], images: []}), close:async () => {}});
  const env = await setup(fixture, browser);
  try {
    const task = await env.runner.create('Invalid AI pass task', 'gpt');
    await waitFor(() => task.status === 'needs_attention');
    assert.notEqual(task.status, 'done');
    assert.match(task.error!, /belum siap/);
  } finally {await env.cleanup();}
});

test('browser infrastructure failure never passes or starts blind code revisions', async () => {
  const env = await setup(fixture, async () => {throw new Error('Browser executable unavailable');});
  try {
    const task = await env.runner.create('Missing browser infrastructure', 'gpt');
    await waitFor(() => task.status === 'needs_attention');
    assert.equal(task.retry, 0);
    assert.match(task.error!, /Browser executable unavailable/);
  } finally {await env.cleanup();}
});

test('role ownership prevents a frontend from overwriting the backend contract', async () => {
  const env = await setup(async request => {
    const result = await fixture(request);
    if (request.role === 'frontend') result.output.files.push({path:'CONTRACT.json', content:'{}'});
    return result;
  });
  try {
    const task = await env.runner.create('Invalid ownership task', 'gpt');
    await waitFor(() => task.status === 'needs_attention');
    assert.match(task.error!, /tidak memiliki file CONTRACT/);
    await assert.rejects(readFile(path.join(task.workspace, 'index.html')));
  } finally {await env.cleanup();}
});

test('QA corrects a defective test plan without revising good application code', async () => {
 let frontendCalls=0, plans=0;
 const env=await setup(async request=>{
  const result=await fixture(request);
  if(request.role==='frontend')frontendCalls++;
  if(request.role==='qa'&&request.phase==='test-plan')plans++;
  if(request.role==='qa'&&request.phase==='review'&&request.task.retry===0){
   result.output.verdict='revise';result.output.findings=[{role:'qa',summary:'Wrong test assumption',reproduction:'Case uses previous case data',expected:'Each case prepares its state',actual:'Case assumes shared state'}];
  }
  return result;
 });
 try {
  const task=await env.runner.create('Correct the test plan only','gpt');
  await waitFor(()=>task.status==='done');
  assert.equal(frontendCalls,1);assert.equal(plans,2);assert.equal(task.retry,1);
  assert.deepEqual(task.findings, [], 'A passing QA closes the active findings; earlier review artifacts preserve their history.');
  assert.deepEqual(env.store.all()[0].findings, []);
 } finally{await env.cleanup();}
});

test('verified projects do not restore resolved findings as pending repairs', async () => {
  const env = await setup();
  try {
    const task = await env.runner.create('Restore a verified project with historical findings', 'gpt');
    await waitFor(() => task.status === 'done');
    task.findings = [{ role: 'frontend', summary: 'QA: obsolete test assumption', reproduction: 'Old run', expected: 'Current regression passes', actual: 'Old test failed' }];
    task.pendingFixes = ['frontend']; env.store.save(task);
    let calls = 0;
    const restored = new Runner(env.store, env.runner.workspaceRoot, () => {}, async request => { calls++; return fixture(request); }, fixture, fixtureBrowser);
    const verified = restored.tasks.find(item => item.id === task.id)!;
    assert.equal(verified.status, 'done');
    assert.deepEqual(verified.findings, []);
    assert.deepEqual(verified.pendingFixes, []);
    assert.deepEqual(env.store.all()[0].findings, []);
    assert.equal(calls, 0);
    await restored.shutdown();
  } finally { await env.cleanup(); }
});

test('a QA pass that still reports a defect cannot mark the project ready', async () => {
  for (const field of ['findings', 'issues'] as const) {
  const env = await setup(async request => {
    const result = await fixture(request);
    if (request.role === 'qa' && request.phase === 'review') {
      if (field === 'findings') result.output.findings = [{ role: 'frontend', summary: 'Visual defect remains', reproduction: 'Inspect the page', expected: 'Aligned layout', actual: 'Misaligned control' }];
      else result.output.issues = ['Visual defect remains'];
    }
    return result;
  });
  try {
    const task = await env.runner.create('Passing browser checks with an unresolved visual defect', 'gpt');
    await waitFor(() => ['done', 'needs_attention'].includes(task.status));
    assert.equal(task.status, 'needs_attention', `The ${field} field must not contradict readiness.`);
    assert.equal(task.findings?.[0].summary, 'Visual defect remains');
    assert.equal(task.stages.find(stage => stage.role === 'qa')?.status, 'failed');
  } finally { await env.cleanup(); }
  }
});

test('token budget stops new paid calls and continuation explicitly extends it', async () => {
 let calls=0;
 const env=await setup(async request=>{calls++;const result=await fixture(request);return {...result,inputTokens:10000,outputTokens:1000};});
 try{
  const task=await env.runner.create('Budget-limited project','gpt',10000);
  await waitFor(()=>task.status==='needs_attention');
  assert.equal(calls,1);assert.equal(task.inputTokens+task.outputTokens,11000);
  assert.match(task.error!,/Batas token project/);
  env.runner.action(task.id,'continue');
  assert.equal(task.tokenBudget,61000);
 }finally{await env.cleanup();}
});

test('QA patches cannot rename IDs or silently change criterion ownership', async () => {
 const {mergeTestPatches}=await import('../server/runner.js');
 const existing=[{id:'one',criterionId:'criterion',title:'Original',steps:[{action:'expectVisible' as const,selector:'#button'}]}];
 assert.throws(()=>mergeTestPatches(existing,[{...existing[0],id:'new-id'}]),/mempertahankan ID/);
 assert.throws(()=>mergeTestPatches(existing,[{...existing[0],criterionId:'different'}]),/mempertahankan ID/);
 const patched=mergeTestPatches(existing,[{...existing[0],title:'Corrected'}]);
 assert.equal(patched.length,1);assert.equal(patched[0].title,'Corrected');
});

test('complex planning is reviewed by Opus before implementation', async () => {
 const models: string[]=[];
 const env=await setup(async request=>{
  const result=await fixture(request);
  if(request.role==='ceo'){models.push(request.routing.model);result.output.plan!.complexity='complex';result.output.plan!.reason='Architecture tradeoffs';}
  return result;
 });
 try{
  const task=await env.runner.create('Complex architecture request','gpt');await waitFor(()=>task.status==='done');
  assert.deepEqual(models,['gpt-6.1-sol','gpt-6-astra']);
 }finally{await env.cleanup();}
});

test('late clarification refreshes shared requirements instead of changing only one engineer', async () => {
 let pmCalls=0;
 const env=await setup(async request=>{
  const result=await fixture(request);if(request.role==='pm')pmCalls++;
  if(request.role==='frontend'&&!request.task.clarifications?.some(item=>item.answers))result.output.questions=[{id:'behavior',question:'Should the greeting persist?',options:['No','Yes']}];
  return result;
 });
 try{
  const task=await env.runner.create('Clarification during implementation','gpt');await waitFor(()=>task.status==='awaiting_input');
  const question=task.clarifications![0];env.runner.answer(task.id,question.id,{behavior:'No'});await waitFor(()=>task.status==='done');
  assert.equal(pmCalls,2);assert.equal(task.clarifications![0].answers!.behavior,'No');
 }finally{await env.cleanup();}
});

test('a design repair reaches the frontend before browser regression and readiness', async () => {
  let designerCalls = 0;
  const env = await setup(async request => {
    const result = await fixture(request);
    if (request.role === 'designer') {
      designerCalls++;
      result.output.files = [{ path: 'DESIGN-SYSTEM.md', content: `feedback: ${designerCalls === 1 ? 120 : 180}ms` }];
    }
    if (request.role === 'frontend') {
      const duration = request.context.includes('feedback: 180ms') ? 180 : 120;
      result.output.files = [{ path: 'index.html', content: html.replace('<button id="hi">', `<button id="hi" style="transition-duration:${duration}ms">`) }];
    }
    if (request.role === 'qa' && request.phase === 'review') {
      const page = await readFile(path.join(request.task.workspace, 'index.html'), 'utf8');
      if (!page.includes('transition-duration:180ms')) {
        result.output.verdict = 'revise';
        result.output.findings = [{ role: 'designer', summary: 'Feedback duration needs alignment', reproduction: 'Click the greeting', expected: '180ms feedback token', actual: '120ms token and implementation' }];
      }
    }
    return result;
  });
  try {
    const task = await env.runner.create('Align action feedback with design system', 'gpt');
    await waitFor(() => ['done', 'needs_attention'].includes(task.status));
    assert.equal(task.status, 'done', task.error);
    assert.equal(task.retry, 1);
    assert.match(await readFile(path.join(task.workspace, 'index.html'), 'utf8'), /transition-duration:180ms/);
    assert.equal(task.failureCounts?.frontend || 0, 0, 'Applying a designer change is not a frontend failure.');
  } finally { await env.cleanup(); }
});

test('mixed repair findings apply the latest contract and design before engineers', async () => {
  let pmCalls = 0, designerCalls = 0;
  const frontendContracts: number[] = [];
  const env = await setup(async request => {
    const result = await fixture(request);
    if (request.role === 'ceo') result.output.plan!.needsBackend = true;
    if (request.role === 'pm') {
      pmCalls++;
      result.output.contract = { version: String(pmCalls), endpoints: [{ method: 'GET', path: '/api/greeting', requestSchema: { type: 'object' }, responses: [{ status: 200, schema: { type: 'object' } }] }] };
    }
    if (request.role === 'designer') {
      designerCalls++;
      result.output.files = [{ path: 'DESIGN-SYSTEM.md', content: `feedback: ${designerCalls === 1 ? 120 : 180}ms` }];
    }
    if (request.role === 'backend') result.output.files = [{ path: 'backend/app.mjs', content: 'export async function handle(){return {status:200,body:{}}}' }];
    if (request.role === 'frontend') {
      frontendContracts.push(Number(request.task.contract?.version));
      const duration = request.context.includes('feedback: 180ms') ? 180 : 120;
      result.output.files = [{ path: 'index.html', content: html.replace('<button id="hi">', `<button id="hi" data-contract="${request.task.contract?.version}" style="transition-duration:${duration}ms">`) }];
    }
    if (request.role === 'qa' && request.phase === 'review' && request.task.retry === 0) {
      result.output.verdict = 'revise';
      result.output.findings = ['frontend', 'designer', 'pm'].map(role => ({ role: role as 'frontend' | 'designer' | 'pm', summary: 'Align shared greeting requirements', reproduction: 'Open greeting', expected: 'Updated contract and motion', actual: 'Original shared requirements' }));
    }
    return result;
  });
  try {
    const task = await env.runner.create('Repair contract and design together', 'gpt');
    await waitFor(() => ['done', 'needs_attention'].includes(task.status));
    assert.equal(task.status, 'done', task.error);
    assert.equal(task.retry, 1);
    assert.deepEqual(frontendContracts, [1, 2]);
    const page = await readFile(path.join(task.workspace, 'index.html'), 'utf8');
    assert.match(page, /data-contract="2"/);
    assert.match(page, /transition-duration:180ms/);
    assert.equal(task.failureCounts?.backend || 0, 0, 'A contract update is not a backend failure.');
  } finally { await env.cleanup(); }
});

test('shutdown drains the active agent before storage closes and stops queued work', async () => {
  let started = false, engineStopped = false;
  const called: string[] = [];
  const env = await setup(async request => {
    called.push(request.task.id);
    started = true;
    await new Promise<void>(resolve => request.signal.addEventListener('abort', () => setTimeout(() => { engineStopped = true; resolve(); }, 75), { once: true }));
    return fixture(request);
  });
  try {
    const active = await env.runner.create('Stop active work before closing', 'gpt');
    await waitFor(() => started);
    const queued = await env.runner.create('Never start this during shutdown', 'gpt');
    await env.runner.shutdown();
    assert.equal(engineStopped, true);
    assert.equal(active.status, 'stopped');
    assert.equal(queued.status, 'stopped');
    assert.deepEqual(called, [active.id]);
    assert.equal(env.store.all().find(task => task.id === active.id)?.status, 'stopped');
    await assert.rejects(env.runner.create('New work after shutdown', 'gpt'), /sedang ditutup/);
  } finally { await env.cleanup(); }
});

test('an interrupted paused task can continue after restart without silently pausing again', async () => {
  const env = await setup();
  let restored: Runner | undefined;
  try {
    const task = await env.runner.create('Restore interrupted pause', 'gpt');
    await waitFor(() => task.status === 'done');
    const interrupted = structuredClone(task);
    interrupted.status = 'paused'; interrupted.pauseRequested = true;
    interrupted.stages.find(stage => stage.role === 'frontend')!.status = 'waiting';
    await env.runner.shutdown();
    env.store.save(interrupted);
    restored = new Runner(env.store, env.runner.workspaceRoot, () => {}, fixture, fixture, fixtureBrowser);
    restored.health = env.runner.health;
    const recovered = restored.tasks.find(item => item.id === task.id)!;
    assert.equal(recovered.status, 'stopped');
    restored.action(task.id, 'continue');
    await waitFor(() => ['done', 'paused', 'needs_attention'].includes(recovered.status));
    assert.equal(recovered.status, 'done', recovered.error);
  } finally { await restored?.shutdown(); await env.cleanup(); }
});

test('stopping and continuing a clarification reuses the pending question without an agent call', async () => {
  let ceoCalls = 0;
  const env = await setup(async request => {
    if (request.role === 'ceo') ceoCalls++;
    const result = await fixture(request);
    if (request.role === 'ceo' && !request.task.clarifications?.some(item => item.answers)) result.output.questions = [{ id: 'storage', question: 'Where should notes be stored?', options: ['Browser', 'Server'] }];
    return result;
  });
  try {
    const task = await env.runner.create('Stop a pending clarification', 'gpt');
    await waitFor(() => task.status === 'awaiting_input');
    const question = task.clarifications![0];
    env.runner.action(task.id, 'stop');
    env.runner.action(task.id, 'continue');
    await waitFor(() => task.status === 'awaiting_input');
    assert.equal(ceoCalls, 1, 'Do not pay for asking the same pending question again.');
    assert.equal(task.clarifications!.length, 1);
    env.runner.answer(task.id, question.id, { storage: 'Browser' });
    await waitFor(() => task.status === 'done');
  } finally { await env.cleanup(); }
});

for (const restart of [false, true]) test(`continuing an interrupted repair ${restart ? 'after restart ' : ''}preserves completed roles and runs the unfinished engineer once`, async () => {
  let designerCalls = 0, frontendCalls = 0;
  const frontendContexts: string[] = [];
  const engine: AskEngine = async request => {
    if (request.role === 'designer') designerCalls++;
    if (request.role === 'frontend') {
      frontendCalls++; frontendContexts.push(request.context);
      if (frontendCalls === 2) await new Promise<void>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('Interrupted repair')), { once: true }));
    }
    const result = await fixture(request);
    if (request.role === 'qa' && request.phase === 'review' && request.task.retry === 0) {
      result.output.verdict = 'revise';
      result.output.findings = [{ role: 'designer', summary: 'Align button tokens', reproduction: 'Inspect button', expected: 'Shared token', actual: 'Different token' }];
    }
    return result;
  };
  const env = await setup(engine);
  let restored: Runner | undefined;
  try {
    const task = await env.runner.create('Stop and continue an active design repair', 'gpt');
    await waitFor(() => frontendCalls === 2);
    env.runner.action(task.id, 'stop');
    await waitFor(() => task.usage?.some(item => item.status === 'interrupted') || false);
    let runner = env.runner;
    if (restart) {
      await runner.shutdown();
      restored = new Runner(env.store, runner.workspaceRoot, () => {}, engine, engine, fixtureBrowser);
      restored.health = runner.health; runner = restored;
    }
    const current = runner.tasks.find(item => item.id === task.id)!;
    runner.action(task.id, 'continue');
    await waitFor(() => current.status === 'done' || current.status === 'needs_attention');
    assert.equal(current.status, 'done', current.error);
    assert.equal(designerCalls, 2, 'Do not rerun a completed repair.');
    assert.equal(frontendCalls, 3, 'The interrupted engineer runs only once on continuation.');
    assert.match(frontendContexts.at(-1)!, /REPAIR:/);
  } finally { await restored?.shutdown(); await env.cleanup(); }
});

test('old report files cannot bypass a requirements refresh interrupted after clarification', async () => {
  const calls: string[] = [];
  let refreshing = false, blockRefreshOnce = true;
  const env = await setup(async request => {
    calls.push(request.role);
    const answered = request.task.clarifications?.some(item => item.answers);
    if (request.role === 'ceo' && answered && blockRefreshOnce) {
      blockRefreshOnce = false; refreshing = true;
      await new Promise<void>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('Refresh stopped')), { once: true }));
    }
    const result = await fixture(request);
    if (request.role === 'frontend' && !answered) result.output.questions = [{ id: 'choice', question: 'Which product behavior?', options: ['Updated behavior'] }];
    if (request.role === 'pm' && answered) result.output.markdown = 'Updated specification after the user decision';
    return result;
  });
  try {
    const task = await env.runner.create('Refresh requirements, then stop and continue', 'gpt');
    await waitFor(() => task.status === 'awaiting_input');
    env.runner.answer(task.id, task.clarifications![0].id, { choice: 'Updated behavior' });
    await waitFor(() => refreshing);
    env.runner.action(task.id, 'stop');
    await waitFor(() => task.usage?.some(item => item.status === 'interrupted') || false);
    env.runner.action(task.id, 'continue');
    await waitFor(() => task.status === 'done');
    assert.equal(calls.filter(role => role === 'ceo').length, 3, 'Interrupted refreshed planning must run again.');
    assert.equal(calls.filter(role => role === 'pm').length, 2, 'The old SPEC.md is not a completed refresh.');
    assert.equal(calls.filter(role => role === 'designer').length, 2);
    assert.match(await readFile(path.join(task.workspace, 'SPEC.md'), 'utf8'), /Updated specification/);
  } finally { await env.cleanup(); }
});
