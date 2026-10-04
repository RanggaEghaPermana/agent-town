import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PreviewManager, ProjectRuntime } from '../server/runtime.js';
import { saveFiles } from '../server/files.js';
import type { Task } from '../shared/types.js';

async function reachable(url: string) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-preview-lifecycle-'));
  const manager = new PreviewManager();
  const instances: ProjectRuntime[] = [];
  const originalStart = ProjectRuntime.prototype.start;
  ProjectRuntime.prototype.start = function () { instances.push(this); return originalStart.call(this); };
  const task = async (id: string) => {
    const workspace = path.join(root, id);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(workspace);
    const files = await saveFiles(workspace, [{ path: 'index.html', content: `<html><body>${id}</body></html>` }], 'frontend');
    return { id, workspace, files, plan: { needsBackend: false } } as Task;
  };
  return { manager, instances, task, cleanup: async () => {
    ProjectRuntime.prototype.start = originalStart;
    await manager.shutdown();
    // Also stop untracked instances so a failed regression cannot leak a server.
    await Promise.all(instances.map(runtime => runtime.stop()));
    await rm(root, { recursive: true, force: true });
  } };
}

test('concurrent preview requests for the same project preserve one origin and all servers close', async () => {
  const env = await setup();
  try {
    const task = await env.task('same-project');
    const urls = await Promise.all(Array.from({ length: 5 }, () => env.manager.open(task)));
    await env.manager.shutdown();
    const stillServing = await Promise.all(urls.map(reachable));
    assert.equal(new Set(urls).size, 1, 'One project must retain its browser storage origin.');
    assert.deepEqual(stillServing, [false, false, false, false, false], 'No untracked preview may survive shutdown.');
  } finally { await env.cleanup(); }
});

test('concurrent previews still enforce the three-project limit', async () => {
  const env = await setup();
  try {
    const tasks = await Promise.all(Array.from({ length: 5 }, (_, index) => env.task(`project-${index}`)));
    const urls = await Promise.all(tasks.map(task => env.manager.open(task)));
    assert.equal((await Promise.all(urls.map(reachable))).filter(Boolean).length, 3);
    await env.manager.shutdown();
    assert.equal((await Promise.all(urls.map(reachable))).filter(Boolean).length, 0);
  } finally { await env.cleanup(); }
});

test('closing a preview while it starts waits for startup and releases its port', async () => {
  const env = await setup();
  const trackedStart = ProjectRuntime.prototype.start;
  let release = () => {}, entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  ProjectRuntime.prototype.start = async function () { entered(); await gate; return trackedStart.call(this); };
  try {
    const task = await env.task('close-during-start');
    const opening = env.manager.open(task);
    await started;
    const closing = env.manager.close(task.id);
    release();
    const url = await opening;
    await closing;
    assert.equal(await reachable(url), false);
  } finally { release(); await env.cleanup(); }
});

test('shutdown drains an opening preview and prevents later opens', async () => {
  const env = await setup();
  const trackedStart = ProjectRuntime.prototype.start;
  let release = () => {}, entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  ProjectRuntime.prototype.start = async function () { entered(); await gate; return trackedStart.call(this); };
  try {
    const task = await env.task('shutdown-during-start');
    const opening = env.manager.open(task).then(url => ({ url, error: '' }), error => ({ url: '', error: (error as Error).message }));
    await started;
    const shutdown = env.manager.shutdown();
    release();
    const result = await opening;
    await shutdown;
    assert.match(result.error, /ditutup/);
    assert.ok(env.instances.every(runtime => runtime.url), 'Startup was exercised with a real HTTP server.');
    assert.deepEqual(await Promise.all(env.instances.map(runtime => reachable(runtime.url))), [false]);
    await assert.rejects(env.manager.open(task), /ditutup/);
  } finally { release(); await env.cleanup(); }
});

test('a failed backend startup does not block the next preview or leave its worker alive', { timeout: 10000 }, async () => {
  const env = await setup();
  try {
    const bad = await env.task('bad-backend');
    bad.plan!.needsBackend = true;
    bad.contract = { version: '1', endpoints: [{ method: 'GET', path: '/api/test', requestSchema: { type: 'object' }, responses: [{ status: 200, schema: { type: 'object' } }] }] };
    bad.files.push(...await saveFiles(bad.workspace, [{ path: 'backend/app.mjs', content: 'export const missingHandle = true;' }], 'backend'));
    const good = await env.task('after-failure');
    const [failure, success] = await Promise.allSettled([env.manager.open(bad), env.manager.open(good)]);
    assert.equal(failure.status, 'rejected');
    if (failure.status === 'rejected') assert.match(failure.reason.message, /handle\(\)/);
    assert.equal(success.status, 'fulfilled');
    if (success.status === 'fulfilled') {
      assert.match(await (await fetch(success.value)).text(), /after-failure/);
      await env.manager.shutdown();
      assert.equal(await reachable(success.value), false);
    }
    // Runtime.stop sends SIGKILL; wait for the actual child exit, not just that signal.
    const children = env.instances.map(runtime => (runtime as unknown as { worker?: import('node:child_process').ChildProcess }).worker).filter(Boolean);
    assert.equal(children.length, 1);
    const { default: EventEmitter } = await import('node:events');
    await Promise.all(children.map(child => child!.exitCode !== null || child!.signalCode !== null ? undefined : EventEmitter.once(child!, 'exit', { signal: AbortSignal.timeout(2000) })));
    assert.ok(children.every(child => child!.exitCode !== null || child!.signalCode !== null));
  } finally { await env.cleanup(); }
});
