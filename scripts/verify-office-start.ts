import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, cp, symlink, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-production-'));
const reservations = [createServer(), createServer(), createServer()];
for (const server of reservations) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const ports = reservations.map(server => (server.address() as { port: number }).port);
for (const directory of ['server', 'shared', 'skills', 'gpt/server', 'gpt/shared', 'gpt/skills']) await cp(directory, path.join(root, directory), { recursive: true });
await mkdir(path.join(root, 'scripts'));
await cp('scripts/start-offices.ts', path.join(root, 'scripts/start-offices.ts'));
await cp('package.json', path.join(root, 'package.json'));
for (const directory of ['node_modules', 'dist']) await symlink(path.resolve(directory), path.join(root, directory), 'dir');
for (const server of reservations) await new Promise<void>(resolve => server.close(() => resolve()));
const child = spawn('npm', ['start'], { cwd: root, detached: true, env: { ...process.env, AGENT_TOWN_CLAUDE_PORT: String(ports[0]), AGENT_TOWN_GPT_PORT: String(ports[1]), PORT: String(ports[2]) }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', exited = false;
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-8000); });
const closed = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
const base = `http://127.0.0.1:${ports[2]}`;
try {
  const deadline = Date.now() + 45000;
  let states: any[] = [];
  while (Date.now() < deadline && !exited) {
    try {
      states = await Promise.all(['/api/state', '/gpt/api/state'].map(async endpoint => (await fetch(base + endpoint, { signal: AbortSignal.timeout(2000) })).json()));
      if (states.every(state => state.health?.loggedIn)) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(states.length, 2, output);
  assert.ok(states.every(state => state.health.loggedIn), output);
  assert.ok(states.every(state => state.tasks.length === 0));
  assert.match(states[1].health.provider, /ChatGPT subscription/);
  assert.ok(states[0].workspaceRoot.startsWith(root));
  assert.ok(states[1].workspaceRoot.startsWith(root));
  assert.notEqual(states[0].workspaceRoot, states[1].workspaceRoot);
  assert.match(await (await fetch(base)).text(), /<div id="root">/);
  const report = { checkedAt: new Date().toISOString(), command: 'npm start', separatePorts: ports, isolatedTemporaryDatabases: true, providers: states.map(state => state.health.provider), staticBuildServed: true, tasks: states.map(state => state.tasks.length) };
  await writeFile('output/gpt-office/production-start.json', JSON.stringify(report, null, 2));
  console.log('npm start: both offices and gateway ready; isolated databases, static build, subscription health passed.');
} finally {
  if (child.pid && !exited) process.kill(-child.pid, 'SIGTERM');
  const force = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
  await closed; clearTimeout(force);
  await writeFile('output/gpt-office/production-start.log', output);
  await rm(root, { recursive: true, force: true });
}
for (const port of ports) await assert.rejects(fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1000) }));
console.log('All owned production processes stopped.');
