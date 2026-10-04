import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { eventually, fixtureOffice, simulatedEngine } from './helpers/office.js';

test('real office UI handles clarification, independent queue, controls, files and reconnect', { timeout: 180000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-ui-'));
  const evidenceRoot = path.resolve('output/remaining-ui');
  await mkdir(evidenceRoot, { recursive: true });
  const originalDelay = process.env.DEMO_STAGE_MS;
  process.env.DEMO_STAGE_MS = '150';
  const simulation = simulatedEngine(350);
  let office = await fixtureOffice(root, simulation.engine);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const url = await office.app.listen({ host: '127.0.0.1', port: 0 });
    await page.goto(url);
    await page.getByText('Kantor terhubung', { exact: true }).waitFor();
    const send = async (prompt: string) => {
      await page.getByLabel('Cara menjalankan tugas').selectOption('generated');
      await page.getByRole('textbox', { name: 'Tugas untuk CEO' }).fill(prompt);
      await page.getByRole('button', { name: 'Kirim tugas', exact: true }).click();
      await eventually(() => office.runner.tasks.some(task => task.prompt === prompt));
      return office.runner.tasks.find(task => task.prompt === prompt)!;
    };
    const ambiguous = await send('Klarifikasi: Dua klarifikasi untuk aplikasi catatan');
    await eventually(() => ambiguous.status === 'awaiting_input');
    await page.getByRole('textbox', { name: 'Penyimpanan catatan di mana?' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Kirim jawaban & lanjutkan' }).isDisabled(), true);
    assert.equal(simulation.calls.some(call => call.task === ambiguous.id && call.role === 'frontend'), false);

    const clear = await send('Catatan mandiri yang sudah jelas');
    await eventually(() => clear.status === 'done');
    assert.equal(ambiguous.status, 'awaiting_input');
    await page.getByRole('button', { name: /^Riwayat/ }).click();
    await page.getByRole('button', { name: /Klarifikasi: Dua klarifikasi/ }).click();
    await page.getByRole('button', { name: 'Browser', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Penyimpanan catatan di mana?' }).inputValue(), 'Browser');
    await page.getByRole('button', { name: 'Kirim jawaban & lanjutkan' }).click();
    await eventually(() => ambiguous.clarifications?.length === 2 && ambiguous.status === 'awaiting_input');
    const secondAnswer = page.getByRole('textbox', { name: 'Warna tombol mengikuti tema mana?' });
    await secondAnswer.waitFor();
    assert.equal(await secondAnswer.inputValue(), '', 'A second question with the same field ID must start blank.');
    assert.equal(await page.getByRole('button', { name: 'Kirim jawaban & lanjutkan' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Hijau', exact: true }).click();
    await page.getByRole('button', { name: 'Kirim jawaban & lanjutkan' }).click();
    await eventually(() => ambiguous.status === 'done');
    assert.deepEqual(ambiguous.clarifications?.map(item => item.answers), [{ choice: 'Browser' }, { choice: 'Hijau' }]);
    await page.screenshot({ path: path.join(evidenceRoot, 'clarification-complete.png') });

    const controlled = await send('Jeda dan lanjutkan aplikasi catatan');
    await page.getByRole('button', { name: 'Jeda setelah tahap aktif' }).click();
    await eventually(() => controlled.status === 'paused');
    const callsWhilePaused = simulation.calls.length;
    await page.reload();
    await page.getByRole('button', { name: 'Lanjutkan tugas' }).waitFor();
    assert.equal(simulation.calls.length, callsWhilePaused);
    await page.getByRole('button', { name: 'Lanjutkan tugas' }).click();
    await eventually(() => controlled.status === 'done');

    const stopped = await send('Hentikan dan lanjutkan aplikasi catatan');
    await eventually(() => simulation.calls.some(call => call.task === stopped.id));
    await page.getByRole('button', { name: 'Hentikan tugas' }).click();
    await eventually(() => stopped.status === 'stopped');
    await page.getByRole('button', { name: 'Lanjutkan diagnosis' }).click();
    await eventually(() => stopped.status === 'done');
    assert.equal(stopped.stages.some(stage => stage.status === 'working'), false);

    await page.getByRole('button', { name: /^File \d+/ }).click();
    await page.getByRole('button', { name: /^index\.html / }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Unduh file' }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'index.html');
    assert.equal(await download.failure(), null);
    await page.getByRole('button', { name: 'Tutup dialog' }).click();
    await page.getByRole('button', { name: /^qa\/run-\d+\/case-1\.png / }).click();
    await page.getByAltText('Screenshot hasil pengujian browser QA').waitFor();
    assert.equal(await page.getByAltText('Screenshot hasil pengujian browser QA').evaluate(image => (image as HTMLImageElement).naturalWidth > 0), true);
    await page.getByRole('button', { name: 'Tutup dialog' }).click();

    const callsBeforeRestart = simulation.calls.length;
    const port = new URL(url).port;
    await office.app.close();
    await eventually(async () => (await page.locator('.connection').innerText()) !== 'Kantor terhubung');
    office = await fixtureOffice(root, simulation.engine);
    await office.app.listen({ host: '127.0.0.1', port: Number(port) });
    await eventually(async () => (await page.locator('.connection').innerText()) === 'Kantor terhubung');
    await eventually(() => office.runner.tasks.length === 4);
    assert.equal(simulation.calls.length, callsBeforeRestart, 'Restart must not replay agent calls.');
    assert.equal(office.runner.tasks.find(task => task.id === stopped.id)?.status, 'done');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(evidenceRoot, 'reconnected.png') });
  } finally {
    await browser.close(); await office.app.close();
    if (originalDelay === undefined) delete process.env.DEMO_STAGE_MS; else process.env.DEMO_STAGE_MS = originalDelay;
    await rm(root, { recursive: true, force: true });
  }
});
