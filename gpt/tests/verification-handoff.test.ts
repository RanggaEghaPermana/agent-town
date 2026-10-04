import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeVerification } from '../server/verification-handoff.js';
import { LocalBrowserRuntime } from '../server/local-verification.js';
import type { Task } from '../shared/types.js';

test('a GPT localhost handoff follows the host port while preserving the application route', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'gpt-port-handoff-'));
  await writeFile(path.join(project, 'server.mjs'), `import {createServer} from 'node:http';createServer((req,res)=>res.end(req.url)).listen(Number(process.env.PORT),'127.0.0.1');`);
  const localVerification = normalizeVerification({ kind: 'live', serverCommand: 'PORT="${AGENT_TOWN_PREVIEW_PORT:-${PORT:-3087}}" node server.mjs', url: 'http://localhost:3087/dashboard?test=1' });
  const runtime = new LocalBrowserRuntime({ projectPath: project, localVerification } as Task, new AbortController().signal, () => {});
  try {
    await runtime.start();
    assert.equal(await (await fetch(runtime.url)).text(), '/dashboard?test=1');
    assert.equal(new URL(runtime.url).hostname, '127.0.0.1');
    assert.notEqual(new URL(runtime.url).port, '3087');
  } finally { await runtime.stop(); await rm(project, { recursive: true, force: true }); }
});

test('attached URLs, fixed-port commands and remote targets remain exact', () => {
  for (const verification of [
    { kind: 'live' as const, url: 'http://127.0.0.1:3087/dashboard' },
    { kind: 'live' as const, serverCommand: 'PORT=3087 node server.mjs', url: 'http://127.0.0.1:3087/dashboard' },
    { kind: 'live' as const, serverCommand: 'PORT=$PORT node server.mjs', url: 'https://example.com/dashboard' },
    { kind: 'live' as const, serverCommand: 'PORT=$PORT node server.mjs', url: 'http://127.0.0.1:{port}/dashboard' },
  ]) assert.equal(normalizeVerification(verification), verification);
});
