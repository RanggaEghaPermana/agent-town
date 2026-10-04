import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { eventually, fixtureOffice, simulatedEngine } from './helpers/office.js';

test('office reduced motion freezes its real canvas and preserves meeting, camera and selection actions', { timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-office-motion-'));
  const simulation = simulatedEngine();
  const office = await fixtureOffice(root, simulation.engine);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const url = await office.app.listen({ host: '127.0.0.1', port: 0 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Tampilkan nama karakter' }).click();
    await eventually(async () => await page.locator('.world-agent-label[data-motion="seated"]').count() === 6);
    const canvas = page.locator('.office-3d canvas');
    const first = await canvas.screenshot();
    await page.waitForTimeout(500);
    const second = await canvas.screenshot();
    assert.equal(first.equals(second), true, 'Reduced motion must also stop Three.js character animations.');
    await page.getByRole('button', { name: 'Kamera dari atas' }).click();
    assert.equal((await canvas.screenshot()).equals(first), false, 'The camera action changes the actual canvas.');
    await page.getByRole('button', { name: 'Reset kamera' }).click();
    await page.getByRole('button', { name: 'Kumpulkan tim di meeting' }).click();
    await eventually(async () => await page.locator('.world-agent-label[data-motion="walking"]').count() === 0, 2000);
    const meeting = await canvas.screenshot();
    assert.equal(meeting.equals(first), false, 'The meeting changes positions without a walking animation.');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Kembali ke meja' }).click();
    await eventually(async () => await page.locator('.world-agent-label[data-motion="walking"]').count() > 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await eventually(async () => await page.locator('.world-agent-label[data-motion="walking"]').count() === 0, 2000);
    await mkdir('output/goal-motion', { recursive: true });
    const labels = await page.locator('.world-agent-label').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { role: element.getAttribute('data-agent-id'), hidden: (element as HTMLButtonElement).hidden, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, pointer: style.pointerEvents, z: style.zIndex, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 220) };
    }));
    await writeFile('output/goal-motion/labels.json', JSON.stringify(labels, null, 2));
    await page.screenshot({ path: 'output/goal-motion/before-selection.png' });
    await page.getByRole('button', { name: 'Pilih Prelude di kantor 3D' }).click({ timeout: 10000 });
    assert.equal(await page.getByRole('button', { name: 'Buka laptop Prelude, CEO' }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(simulation.calls, [], 'Visual controls must never consume AI.');
    assert.deepEqual(errors, []);
    await mkdir('output/goal-motion', { recursive: true });
    await page.screenshot({ path: 'output/goal-motion/reduced-office.png' });
  } finally { await browser.close(); await office.app.close(); await rm(root, { recursive: true, force: true }); }
});
