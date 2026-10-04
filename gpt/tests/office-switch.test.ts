import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { request as httpRequest } from 'node:http';
import { fixtureOffice as claudeFixture, simulatedEngine, eventually } from '../../tests/helpers/office.js';
import { createOfficeApp } from '../server/app.js';
import { askDemo, type AskEngine } from '../server/engine.js';
import { createOfficeGateway } from '../server/gateway.js';
import type { Task } from '../shared/types.js';

test('switches between isolated offices, preserves Claude, and GPT demo/files/preview work through HTTP and WebSocket', { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-offices-'));
  const claudeEngine = simulatedEngine(); const claude = await claudeFixture(path.join(root, 'claude'), claudeEngine.engine);
  const calls: string[] = [];
  const engine: AskEngine = async request => { calls.push(`${request.role}:${request.phase}`); return askDemo(request); };
  const gpt = await createOfficeApp({ root: path.resolve('.'), workspaceRoot: path.join(root, 'gpt-projects'), databasePath: path.join(root, 'gpt.sqlite'), localRoot: root, engine, demoEngine: engine, logger: false, health: { installed: true, loggedIn: true, provider: 'GPT test fixture' } });
  const claudeUrl = await claude.app.listen({ host: '127.0.0.1', port: 0 }); const gptUrl = await gpt.app.listen({ host: '127.0.0.1', port: 0 });
  const gateway = createOfficeGateway(path.resolve('dist'), claudeUrl, gptUrl);
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const port = (gateway.address() as { port: number }).port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    for (const endpoint of ['/api/state', '/gpt/api/state']) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${endpoint}`, { headers: { Origin: 'https://example.com' } })).status, 403);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`http://127.0.0.1:${port}${endpoint}`, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); });
        request.on('error', reject); request.end();
      });
      assert.equal(status, 403);
    }
    for (const endpoint of ['/ws', '/gpt/ws']) {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`, { origin: 'https://example.com' });
        socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); try { assert.equal(response.statusCode, 403); resolve(); } catch (error) { reject(error); } });
        socket.once('open', () => { socket.close(); reject(new Error('Foreign-origin socket must not connect.')); });
        socket.on('error', () => {});
      });
    }
    await page.goto(`http://127.0.0.1:${port}`); await page.getByText('Kantor terhubung', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Buka laptop Prelude, CEO' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Claude', exact: true }).getAttribute('aria-pressed'), 'true');
    const originalColor = await page.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.getByRole('button', { name: 'GPT', exact: true }).click(); await page.getByText('Kantor terhubung', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Buka laptop Atlas, CEO' }).waitFor();
    for (const name of ['Nova','Prism','Pixel','Vector','Echo']) assert.equal(await page.getByRole('button', { name: new RegExp(`Buka laptop ${name},`) }).count(), 1);
    assert.notEqual(await page.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor), originalColor);
    await page.getByRole('button', { name: 'Kamera dari atas' }).click(); await page.getByRole('button', { name: 'Reset kamera' }).click();
    await page.getByRole('button', { name: 'Kumpulkan tim di meeting' }).click(); await page.getByRole('button', { name: 'Kembali ke meja' }).click();
    const overview = await page.screenshot({ path: 'output/gpt-office/gpt-ui-desktop.png' }); assert.ok(overview.length);
    await page.getByRole('button', { name: 'Coba demo · 0 token', exact: true }).click();
    await eventually(() => gpt.runner.tasks.length === 1); const task = gpt.runner.tasks[0];
    await page.getByRole('button', { name: 'Claude', exact: true }).click(); await page.getByRole('button', { name: 'Buka laptop Prelude, CEO' }).waitFor();
    assert.equal(await page.locator('.topbar').evaluate(element => getComputedStyle(element).backgroundColor), originalColor);
    assert.equal(claude.runner.tasks.length, 0); assert.equal(claudeEngine.calls.length, 0);
    await eventually(() => task.status === 'done', 50000);
    assert.equal(task.inputTokens + task.outputTokens, 0); assert.equal(task.stages.filter(s => s.status === 'done').length, 5);
    await page.getByRole('button', { name: 'GPT', exact: true }).click(); await page.getByText('Kantor terhubung', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tugas', exact: true }).click(); await page.getByText('Siap', { exact: true }).waitFor();
    assert.equal(await page.getByText('Demo · Aplikasi catatan', { exact: true }).count(), 1);
    await page.getByRole('button', { name: /^File \d+/ }).click(); await page.getByRole('button', { name: /^SPEC\.md / }).click();
    await page.getByRole('dialog', { name: 'SPEC.md' }).waitFor(); await page.getByRole('button', { name: 'Teks asli' }).click();
    assert.match(await page.locator('.source-view').innerText(), /pm/); await page.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.getByRole('button', { name: 'Buka preview hasil' }).click();
    const app = page.frameLocator('iframe[title="Hasil web dari tim agent"]');
    await app.locator('#title').fill('Catatan GPT'); await app.locator('#form button').click(); await app.locator('#notes').getByText('Catatan GPT').waitFor();
    await page.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'output/gpt-office/gpt-ui-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.reload(); await page.getByRole('button', { name: 'Buka laptop Atlas, CEO' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'GPT', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(calls.includes('qa:test-plan') && calls.includes('qa:review')); assert.deepEqual(errors, []);
    const legacyState = await (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
    const gptState = await (await page.request.get(`http://127.0.0.1:${port}/gpt/api/state`)).json();
    assert.equal(legacyState.tasks.length, 0); assert.equal(gptState.tasks.length, 1); assert.equal((gptState.tasks[0] as Task).id, task.id);
  } finally { await browser.close(); await claude.app.close(); await gpt.app.close(); gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
