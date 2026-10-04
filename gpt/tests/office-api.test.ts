import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eventually, fixtureOffice, simulatedEngine } from './helpers/office.js';

test('office API enforces request validation, clarification lifecycle and artifact access', { timeout: 25000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-api-'));
  const previousDelay = process.env.DEMO_STAGE_MS;
  process.env.DEMO_STAGE_MS = '5';
  const simulation = simulatedEngine();
  const { app, runner } = await fixtureOffice(root, simulation.engine);
  const headers = { 'content-type': 'application/json', 'x-agent-town': '1' };
  const post = (url: string, payload: unknown, extra: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: JSON.stringify(payload), headers: { ...headers, ...extra } });
  try {
    const createdBody = { prompt: 'Klarifikasi aplikasi catatan', mode: 'gpt', tokenBudget: 120000 };
    assert.equal((await app.inject({ method: 'POST', url: '/api/tasks', payload: createdBody })).statusCode, 403);
    assert.equal((await post('/api/tasks', createdBody, { origin: 'http://foreign.test' })).statusCode, 403);
    for (const payload of [{ ...createdBody, prompt: 'abc' }, { ...createdBody, mode: 'unknown' }, { ...createdBody, tokenBudget: 9999 }, { ...createdBody, tokenBudget: 1000001 }, { ...createdBody, tokenBudget: 10000.5 }]) {
      assert.equal((await post('/api/tasks', payload)).statusCode, 400);
    }
    assert.equal(runner.tasks.length, 0);
    const created = await post('/api/tasks', createdBody);
    assert.equal(created.statusCode, 200);
    const task = runner.tasks.find(item => item.id === created.json().id)!;
    await eventually(() => task.status === 'awaiting_input');
    const question = task.clarifications![0];
    for (const answers of [{}, { choice: '' }, { choice: 123 }, { choice: 'Browser', extra: 'unexpected' }]) {
      assert.equal((await post(`/api/tasks/${task.id}/answer`, { clarificationId: question.id, answers })).statusCode, 400);
    }
    assert.equal(task.status, 'awaiting_input');
    const answer = { clarificationId: question.id, answers: { choice: 'Browser' } };
    assert.equal((await post(`/api/tasks/${task.id}/answer`, answer)).statusCode, 200);
    assert.equal((await post(`/api/tasks/${task.id}/answer`, answer)).statusCode, 400);
    await eventually(() => task.status === 'done');
    assert.equal((await post(`/api/tasks/${task.id}/pause`, {})).statusCode, 400);
    assert.equal((await post(`/api/tasks/${task.id}/delete`, {})).statusCode, 400);
    const file = await app.inject(`/api/tasks/${task.id}/file?path=index.html`);
    assert.equal(file.statusCode, 200);
    assert.match(file.json().content, /Catatan kecil/);
    assert.equal((await app.inject(`/api/tasks/${task.id}/file?path=..%2Foutside.md`)).statusCode, 404);
    assert.equal((await app.inject(`/api/tasks/${task.id}/evidence?path=index.html`)).statusCode, 404);
    const picture = task.files.find(file => file.path.endsWith('case-1.png'))!;
    const screenshot = await app.inject(`/api/tasks/${task.id}/evidence?path=${encodeURIComponent(picture.path)}`);
    assert.equal(screenshot.statusCode, 200);
    assert.equal(screenshot.headers['content-type'], 'image/png');
    assert.equal(screenshot.rawPayload.subarray(1, 4).toString(), 'PNG');
    assert.equal((await app.inject(`/api/tasks/${task.id}/file?path=${encodeURIComponent(picture.path)}`)).statusCode, 400);
    const download = await app.inject(`/api/tasks/${task.id}/download?path=index.html`);
    assert.equal(download.headers['content-disposition'], 'attachment; filename="index.html"');
    assert.match(download.body, /Catatan kecil/);
    assert.equal((await app.inject('/api/unknown')).statusCode, 404);
    assert.equal(task.inputTokens + task.outputTokens, 0);
  } finally {
    await app.close();
    if (previousDelay === undefined) delete process.env.DEMO_STAGE_MS; else process.env.DEMO_STAGE_MS = previousDelay;
    await rm(root, { recursive: true, force: true });
  }
});
