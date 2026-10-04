import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixtureOffice, eventually } from './helpers/office.js';

const answer = [
  '## Gambaran project',
  '',
  'Aplikasi kasir **Dagangin** memiliki frontend, backend dan mobile. Penjelasan ini mempertahankan informasi aslinya.',
  '',
  '**Update terakhir (hasil `git log`):**',
  '- `6f58e6f` (2 Okt): Oren, maskot kucing, kini menemani pengguna. File yang berubah:',
  '  - `frontend/src/components/mascot/OrenCompanion.tsx`',
  '  - `frontend/src/components/mascot/companion-brain.ts`',
  '- `c3b336e` (28 Sep): tag Open Graph untuk pratinjau tautan.',
  '',
  '| Area | Peran | Folder | Catatan | Status | Pemeriksaan |',
  '| --- | --- | --- | --- | --- | --- |',
  '| Frontend | Designer | frontend/src/components/mascot/ | Animasi selaras | Siap | Browser |',
  '| Backend | Engineer | backend/src/ | Kontrak sesuai | Siap | Integrasi |',
  '',
  '```bash',
  'npm run verify -- --path=frontend/src/components/mascot/OrenCompanion.tsx --include-very-long-regression-scenario',
  '```',
  '',
  '[Dokumentasi](https://example.com/docs) · [tautan berbahaya](javascript:alert(1))',
  '<img src=x onerror="window.__injected=true">',
  '<script>window.__injected=true</script>',
].join('\n');

test('answers and saved reports render as readable documents with wide view, font controls, copying and safe links', { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-reader-'));
  let calls = 0;
  const office = await fixtureOffice(root, async () => {
    calls++;
    return { output: { summary: 'Penjelasan project selesai', markdown: answer, files: [], verdict: 'none', issues: [], questions: [], plan: { kind: 'answer', needsBackend: false, needsDesign: false, complexity: 'clear', reason: 'Read-only report fixture' } }, inputTokens: 2, outputTokens: 3 };
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve('output/report-reader'); await mkdir(output, { recursive: true });
  try {
    const task = await office.runner.create('Jelaskan project yang sudah ada', 'claude', 120000, { access: 'local', projectPath: root });
    await eventually(() => task.status === 'done');
    await page.goto(await office.app.listen({ host: '127.0.0.1', port: 0 }));
    await page.getByText('Kantor terhubung', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tugas', exact: true }).click();
    const card = page.locator('.task-answer');
    assert.equal(await card.getByRole('heading', { name: 'Gambaran project' }).count(), 1);
    assert.equal(await card.locator('strong').filter({ hasText: 'Update terakhir' }).count(), 1);
    assert.equal(await card.locator('ul ul code').count(), 2);
    assert.equal(await card.locator('table').count(), 1);
    assert.equal(await card.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await card.locator('img,script').count(), 0);
    assert.equal(await page.evaluate(() => '__injected' in window), false);
    const link = card.getByRole('link', { name: 'Dokumentasi' });
    assert.equal(await link.getAttribute('target'), '_blank'); assert.match((await link.getAttribute('rel'))!, /noopener/);
    await page.getByRole('button', { name: 'Baca lebar' }).click();
    const reader = page.getByRole('dialog', { name: 'Jawaban Prelude' }); await reader.waitFor();
    assert.ok((await reader.boundingBox())!.width > 800);
    const readingDoc = reader.getByRole('article', { name: 'Penjelasan lengkap' });
    assert.equal(await readingDoc.locator('.report-markdown').evaluate(element => getComputedStyle(element).fontSize), '17px');
    await reader.getByRole('button', { name: 'Perbesar teks' }).click();
    assert.equal(await readingDoc.locator('.report-markdown').evaluate(element => getComputedStyle(element).fontSize), '18px');
    await reader.getByRole('button', { name: 'Salin teks' }).click();
    await reader.getByText('Tersalin', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), answer);
    await page.screenshot({ path: path.join(output, 'wide-report.png') });
    await page.keyboard.press('Escape'); await reader.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Baca lebar' }).evaluate(element => element === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Baca lebar' }).click(); await reader.waitFor();
    assert.equal(await reader.getByLabel('Ukuran teks saat ini').innerText(), '18');
    assert.ok((await reader.boundingBox())!.width <= 390);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await reader.evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    for (let index = 0; index < 2; index++) await reader.getByRole('button', { name: 'Perbesar teks' }).click();
    assert.equal(await reader.getByRole('button', { name: 'Perbesar teks' }).isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'mobile-report.png') });
    await reader.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.getByRole('button', { name: /^File \d+/ }).click();
    await page.getByRole('button', { name: /^PLAN\.md / }).click();
    const file = page.getByRole('dialog', { name: 'PLAN.md' }); await file.waitFor();
    await file.getByRole('heading', { name: 'Gambaran project' }).waitFor();
    await file.getByRole('button', { name: 'Teks asli' }).click();
    assert.equal(await file.locator('.source-view').innerText(), answer);
    await file.getByRole('button', { name: 'Tampilan baca' }).click();
    const downloadWait = page.waitForEvent('download'); await file.getByRole('link', { name: 'Unduh file' }).click();
    const download = await downloadWait; assert.equal(download.suggestedFilename(), 'PLAN.md');
    assert.equal(await readFile((await download.path())!, 'utf8'), answer);
    await file.getByRole('button', { name: 'Tutup dialog' }).click();
    assert.equal(await readFile(path.join(task.workspace, 'PLAN.md'), 'utf8'), answer);
    assert.equal(calls, 1, 'Formatting, enlarging, copying and viewing reports must not invoke an agent.');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await office.app.close(); await rm(root, { recursive: true, force: true }); }
});
