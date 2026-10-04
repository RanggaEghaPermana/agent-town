import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { compileContract, ProjectRuntime } from '../server/runtime.js';
import { saveFiles } from '../server/files.js';
import { openBrowserQA } from '../server/browser-qa.js';
import type { ApiContract, Task } from '../shared/types.js';

function contract(): ApiContract {
  return { version: '1', endpoints: [{ method: 'GET', path: '/api/items/:id', requestSchema: { type: 'object' }, responses: [{ status: 200, schema: { type: 'object', required: ['data'], properties: { data: { type: 'integer' } } } }] }] };
}

test('contracts reject invalid HTTP response statuses before an engineer starts', () => {
  for (const status of [0, 99, 600, 200.5]) {
    const invalid = contract(); invalid.endpoints[0].responses[0].status = status;
    assert.throws(() => compileContract(invalid), /status/i);
  }
});

test('contracts cannot silently overwrite duplicate response schemas for the same status', () => {
  const invalid = contract();
  invalid.endpoints[0].responses.push({ status: 200, schema: { type: 'string' } });
  assert.throws(() => compileContract(invalid), /duplikat/i);
});

test('equivalent parameterized routes cannot declare conflicting contracts', () => {
  const invalid = contract();
  invalid.endpoints.push({ ...invalid.endpoints[0], path: '/api/items/:slug' });
  assert.throws(() => compileContract(invalid), /duplikat/i);
});

test('static routes use their own schema and cannot falsely cover a dynamic endpoint in browser QA', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-route-specificity-'));
  let runtime: ProjectRuntime | undefined;
  let session: Awaited<ReturnType<typeof openBrowserQA>> | undefined;
  try {
    const api = contract();
    api.endpoints.push({ method: 'GET', path: '/api/items/search', requestSchema: { type: 'object' }, responses: [{ status: 200, schema: { type: 'object', required: ['data'], properties: { data: { type: 'string' } } } }] });
    const files = [...await saveFiles(root, [{ path: 'index.html', content: '<html><head><title>Routes</title><meta name="viewport" content="width=device-width"></head><body><h1>Routes</h1></body></html>' }], 'frontend'),
      ...await saveFiles(root, [{ path: 'backend/app.mjs', content: 'export function handle({path}) { return {status:200, body:{data:path === "/api/items/search" ? "Found" : 42}}; }' }], 'backend')];
    const task = { workspace: root, files, contract: api, plan: { needsBackend: true }, retry: 0, criteria: [{ id: 'search', description: 'Search returns text', category: 'happy' }] } as Task;
    runtime = await new ProjectRuntime(task, false).start();
    const search = await fetch(runtime.url + '/api/items/search');
    assert.equal(search.status, 200);
    assert.deepEqual(await search.json(), { data: 'Found' });
    assert.deepEqual(await (await fetch(runtime.url + '/api/items/123')).json(), { data: 42 });
    session = await openBrowserQA(task, new AbortController().signal, () => {});
    const report = await session.run([{ id: 'search', criterionId: 'search', title: 'Search route', steps: [{ action: 'api', value: '/api/items/search', status: 200, responseBody: '{"data":"Found"}' }] }]);
    assert.equal(report.evidence[0].passed, true);
    const dynamicCoverage = report.checks.find(check => check.name.startsWith('Endpoint GET ') && check.name.includes('[^/]+'));
    assert.equal(dynamicCoverage?.passed, false, 'Calling /search did not execute the :id route.');
  } finally { await session?.close(); await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
});
