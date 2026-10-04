import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { eventually, fixtureOffice, simulatedEngine } from './helpers/office.js';

test('an older file response cannot replace the latest file or show an obsolete error', { timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-file-race-'));
  const originalDelay = process.env.DEMO_STAGE_MS;
  process.env.DEMO_STAGE_MS = '1';
  const office = await fixtureOffice(root, simulatedEngine().engine);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const outcomes: { mode: string; title: string | null; alerts: string[] }[] = [];
  try {
    const task = await office.runner.create('Klarifikasi untuk menguji file', 'demo');
    await eventually(() => task.status === 'awaiting_input');
    const url = await office.app.listen({ host: '127.0.0.1', port: 0 });
    for (const mode of ['stale-success', 'late-error']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      let release = () => {}, captured = () => {};
      const hold = new Promise<void>(resolve => { release = resolve; });
      const requested = new Promise<void>(resolve => { captured = resolve; });
      const oldURL = `${url}/api/tasks/${task.id}/file?path=BRIEF.md`;
      await page.route(oldURL, async route => {
        const response = await route.fetch(); captured(); await hold;
        if (mode === 'stale-success') await route.fulfill({ response });
        else await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Obsolete file failure"}' });
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: /^File \d+/ }).click();
        await page.getByRole('button', { name: /^BRIEF\.md / }).click();
        await requested;
        await page.getByRole('button', { name: /^TEAM-RULES\.md / }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('heading', { name: 'TEAM-RULES.md', exact: true }).waitFor();
        const arrived = page.waitForResponse(response => response.url() === oldURL);
        release(); await arrived; await page.waitForTimeout(400);
        outcomes.push({ mode, title: await dialog.getByRole('heading').textContent(), alerts: await page.getByRole('alert').allTextContents() });
        await page.getByRole('button', { name: 'Tutup dialog' }).click();
        assert.equal(await page.getByRole('dialog').count(), 0);
      } finally { release(); await page.close(); }
    }
    assert.deepEqual(outcomes, [
      { mode: 'stale-success', title: 'TEAM-RULES.md', alerts: [] },
      { mode: 'late-error', title: 'TEAM-RULES.md', alerts: [] },
    ]);
  } finally {
    await browser.close(); await office.app.close();
    if (originalDelay === undefined) delete process.env.DEMO_STAGE_MS; else process.env.DEMO_STAGE_MS = originalDelay;
    await rm(root, { recursive: true, force: true });
  }
});
