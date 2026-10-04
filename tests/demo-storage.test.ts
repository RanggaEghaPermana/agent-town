import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { askDemo } from '../server/engine.js';
import { ProjectRuntime } from '../server/runtime.js';
import { saveFiles } from '../server/files.js';
import type { Task } from '../shared/types.js';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-demo-storage-'));
  const originalDelay = process.env.DEMO_STAGE_MS;
  process.env.DEMO_STAGE_MS = '1';
  const task = { workspace: root, plan: { needsBackend: false } } as Task;
  let runtime: ProjectRuntime | undefined;
  try {
    const result = await askDemo({ role: 'frontend', task, context: '', signal: new AbortController().signal, onOutput: () => {}, routing: { model: 'claude-sonnet-5-5', effort: 'medium', reason: 'Local demo fixture' } });
    task.files = await saveFiles(root, result.output.files, 'frontend');
    runtime = await new ProjectRuntime(task, false).start();
    const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
    return { url: runtime.url, browser, cleanup: async () => { await browser.close(); await runtime!.stop(); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await runtime?.stop(); await rm(root, { recursive: true, force: true }); throw error; }
  finally { if (originalDelay === undefined) delete process.env.DEMO_STAGE_MS; else process.env.DEMO_STAGE_MS = originalDelay; }
}

test('demo preserves valid notes and remains usable when stored entries are malformed', async () => {
  const env = await setup();
  try {
    const context = await env.browser.newContext();
    await context.addInitScript(() => localStorage.setItem('agent-town-demo-notes', '[null,{"id":"broken","title":42},{"id":"valid","title":"Tetap ada","body":"Isi"}]'));
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(env.url, { waitUntil: 'networkidle' });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('#notes article h2').innerText(), 'Tetap ada');
    assert.match(await page.locator('#storage-status').innerText(), /rusak/);
    await page.fill('#title', 'Catatan baru'); await page.click('#form button');
    assert.equal(await page.locator('#notes article').count(), 2);
    await context.close();
  } finally { await env.cleanup(); }
});

test('demo keeps create/delete state intact on storage failure and can retry successfully', async () => {
  const env = await setup();
  try {
    const context = await env.browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('agent-town-demo-notes', '[{"id":"old","title":"Jangan hilang","body":"Isi"}]');
      const original = Storage.prototype.setItem;
      Object.assign(window, { storageFails: true });
      Storage.prototype.setItem = function (key, value) {
        if ((window as unknown as { storageFails: boolean }).storageFails) throw new DOMException('Fixture quota failure', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(env.url, { waitUntil: 'networkidle' });
    await page.fill('#title', 'Coba lagi'); await page.fill('#body', 'Isi tetap ada'); await page.click('#form button');
    assert.equal(await page.inputValue('#title'), 'Coba lagi');
    assert.equal(await page.inputValue('#body'), 'Isi tetap ada');
    assert.equal(await page.locator('#notes article').count(), 1);
    assert.match(await page.locator('#storage-status').innerText(), /Gagal menyimpan/);
    await page.locator('#notes article button').click();
    assert.equal(await page.locator('#notes article h2').innerText(), 'Jangan hilang');
    await page.evaluate(() => Object.assign(window, { storageFails: false }));
    await page.click('#form button');
    assert.equal(await page.locator('#notes article').count(), 2);
    assert.equal(await page.inputValue('#title'), '');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agent-town-demo-notes')!).length), 2);
    await page.locator('#notes article').filter({ hasText: 'Jangan hilang' }).getByRole('button', { name: 'Hapus' }).click();
    assert.equal(await page.locator('#notes article').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await env.cleanup(); }
});
