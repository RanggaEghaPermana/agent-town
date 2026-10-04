import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { eventually, fixtureOffice, simulatedEngine } from './helpers/office.js';

test('late bootstrap responses and errors cannot overwrite a live WebSocket state', { timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-bootstrap-'));
  const originalDelay = process.env.DEMO_STAGE_MS;
  process.env.DEMO_STAGE_MS = '20';
  const simulation = simulatedEngine();
  const office = await fixtureOffice(root, simulation.engine);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const outcomes: { mode: string; visible: boolean; alerts: string[] }[] = [];
  const errors: string[] = [];
  try {
    const url = await office.app.listen({ host: '127.0.0.1', port: 0 });
    for (const mode of ['stale-success', 'late-error']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('pageerror', error => errors.push(error.message));
      let release = () => {}, captured = () => {};
      const hold = new Promise<void>(resolve => { release = resolve; });
      const requested = new Promise<void>(resolve => { captured = resolve; });
      await page.route('**/api/state', async route => {
        const response = await route.fetch();
        captured(); await hold;
        if (mode === 'stale-success') await route.fulfill({ response });
        else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated bootstrap unavailable' }) });
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await requested;
        await page.getByText('Kantor terhubung', { exact: true }).waitFor();
        const created = await office.app.inject({ method: 'POST', url: '/api/tasks', headers: { 'X-Agent-Town': '1' }, payload: { prompt: `Klarifikasi ${mode} catatan`, mode: 'demo' } });
        assert.equal(created.statusCode, 200);
        const id = created.json().id;
        await eventually(() => office.runner.tasks.find(task => task.id === id)?.status === 'awaiting_input');
        const question = page.getByRole('textbox', { name: 'Penyimpanan catatan di mana?' });
        await question.waitFor();
        const responseArrived = page.waitForResponse(response => response.url() === `${url}/api/state`);
        release(); await responseArrived;
        // Let fetch JSON consumption and React rendering finish after the HTTP response.
        await page.waitForTimeout(400);
        outcomes.push({ mode, visible: await question.isVisible(), alerts: await page.getByRole('alert').allTextContents() });
        await mkdir('output/edge-ui', { recursive: true });
        await page.screenshot({ path: `output/edge-ui/${mode}.png` });
      } finally { release(); await page.close(); }
    }
    assert.deepEqual(outcomes, [
      { mode: 'stale-success', visible: true, alerts: [] },
      { mode: 'late-error', visible: true, alerts: [] },
    ]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await office.app.close();
    if (originalDelay === undefined) delete process.env.DEMO_STAGE_MS; else process.env.DEMO_STAGE_MS = originalDelay;
    await rm(root, { recursive: true, force: true });
  }
});
