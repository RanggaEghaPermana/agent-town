import { mkdtemp, writeFile, mkdir, rm, cp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../gpt/server/store.js';
import { Runner } from '../gpt/server/runner.js';
import { engineHealth } from '../gpt/server/engine.js';
import { normalizeVerification } from '../gpt/server/verification-handoff.js';
import type { Task } from '../gpt/shared/types.js';
import { appendFileSync } from 'node:fs';
import { askGPT } from '../gpt/server/engine.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-gpt-live-'));
const project = path.join(root, 'project'); await mkdir(project);
await writeFile(path.join(project, 'README.md'), `# Counter fixture\nAplikasi uji sementara, belum ada fitur. Node.js tersedia. Jalankan node server.mjs; server harus membaca process.env.PORT.\nGunakan vanilla HTML/CSS/JS dan server HTTP Node untuk fixture kecil ini. Tidak perlu menginstal dependensi atau menghubungi layanan luar.\nDesign system: latar putih, teks graphite, aksen mint, spacing 8/16/24, radius 8px.\n`);
await writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Counter GPT</title></head><body><main><h1>Counter GPT</h1><p>Belum diimplementasikan.</p></main></body></html>');
const store = new Store(path.join(root, 'office.sqlite'));
let resumed: Task | undefined;
if (process.argv.includes('--resume-checkpoint')) {
  const previous: Task = JSON.parse(await readFile('output/gpt-office/live-pipeline.json', 'utf8'));
  if (!['needs_attention', 'stopped', 'failed', 'awaiting_input'].includes(previous.status)) throw new Error('Checkpoint harus berasal dari uji provider yang sudah berhenti.');
  const checkpoint = path.resolve('output/gpt-office/live-checkpoint');
  await cp(path.join(checkpoint, 'project'), project, { recursive: true });
  const workspace = path.join(root, 'reports', previous.id);
  await cp(path.join(checkpoint, 'reports', previous.id), workspace, { recursive: true });
  await writeFile(`output/gpt-office/live-pipeline-attempt-${Date.now()}.json`, JSON.stringify(previous, null, 2));
  resumed = { ...previous, status: 'stopped', projectPath: project, workspace, pauseRequested: false,
    tokenBudget: Math.max(previous.tokenBudget || 300000, previous.inputTokens + previous.outputTokens + 100000),
    changedFiles: previous.changedFiles?.map(file => ({ ...file, path: file.path.replace(previous.projectPath!, project) })),
    ...(previous.localVerification ? { localVerification: normalizeVerification(previous.localVerification) } : {}) };
  if (process.argv.includes('--qa-fixture')) {
    resumed.localVerification = { kind: 'live', serverCommand: 'node qa-server.mjs', url: 'http://127.0.0.1:{port}/' };
    await writeFile(path.join(project, 'qa-control.json'), '{"failNextPost":false}');
    await writeFile(path.join(project, 'QA-FIXTURE.md'), `# Pengaturan fixture QA\nHost menjalankan qa-server.mjs, yang meneruskan ke implementasi counter asli. Respons API diberi latency 700 ms agar loading dapat diamati. Untuk C4, tulis {"failNextPost":true} ke qa-control.json melalui terminal; POST berikutnya menghasilkan 503 dengan {"error":"Gangguan uji sementara."}, lalu fault otomatis hilang dan retry harus berhasil. Ini data kontrol fixture sementara, bukan perubahan implementasi. Jangan intercept jaringan Chrome. Untuk C5 pakai capability viewport 375px dan emulasi reduced motion yang didokumentasikan pada aturan browser; verifikasi matchMedia dan perilaku tampilan, lalu pulihkan override.\n`);
  }
  store.save(resumed);
}
const runner = new Runner(store, path.join(root, 'reports'), () => {}, request => askGPT({ ...request, onToolDiagnostic: item => appendFileSync('output/gpt-office/chrome-tool-trace.jsonl', JSON.stringify({ time: new Date().toISOString(), role: request.role, ...item }) + '\n') }), undefined, undefined, project);
const interrupt = () => { for (const task of runner.tasks) if (['running', 'queued', 'pausing', 'paused'].includes(task.status)) runner.action(task.id, 'stop'); };
process.once('SIGTERM', interrupt);
process.once('SIGINT', interrupt);
let last = '';
try {
  runner.health = await engineHealth(); if (!runner.health.loggedIn) throw new Error(runner.health.error);
  const note = process.argv.includes('--qa-fixture')
    ? 'Chrome dipulihkan oleh pengguna dan host sudah berhasil menjalankan UI, reload, serta emulasi reduced motion. Lanjutkan QA atas implementasi yang sudah selesai. Baca QA-FIXTURE.md untuk latency dan data kontrol error yang disediakan host; seluruh kriteria tetap harus diuji di Chrome, lalu pulihkan viewport/motion dan bersihkan data uji. Setelah semua hasil diamati, kembalikan JSON ringkas segera. Jangan tutup tab sebelum hasil akhir: host akan membersihkan sesi. Error kanal pesan ekstensi yang muncul setelah pengujian perlu dinyatakan dengan jujur, tetapi jangan mengulang seluruh pengujian atau menebak sumbernya tanpa bukti.'
    : 'Adapter GPT telah memperbaiki konfigurasi plugin dan menyelaraskan URL localhost dengan PORT runtime. Lanjutkan QA live atas implementasi yang sudah selesai; uji seluruh kriteria melalui Chrome.';
  const task = resumed ? runner.action(resumed.id, 'continue', { note }) : await runner.create(`Implementasikan counter server pada fixture di folder kerja ini. Pengguna melihat nilai mulai dari 0, tombol Tambah menaikkan nilai melalui POST /api/counter, tombol Reset mengembalikan ke 0 melalui POST /api/counter/reset. Respons ketiga endpoint selalu {value:number}, error {error:string}. Keduanya tidak membutuhkan body. Membaca halaman kembali mengambil nilai dari GET /api/counter selama server masih hidup. Buat UI putih/graphite/mint sesuai design system README, dengan state loading, sukses dan error serta animasi feedback reduced-motion. Echo harus menguji langsung di Chrome dari awal sampai akhir dan memastikan nilai yang terlihat sesuai respons API. Gunakan data uji dan tidak perlu login, layanan eksternal atau deploy. Scope selesai: (1) Tambah terlihat 1 dengan API sesuai; (2) reload mempertahankan 1; (3) Reset terlihat 0; (4) di lebar ponsel tidak overflow dan reduced-motion tetap bisa dipakai. Server port dari PORT; serahkan localVerification kind live kepada QA dengan URL http://127.0.0.1:{port}.`, 'gpt', 300000, { access: 'local', projectPath: project });
  // These flags acknowledge only a browser interruption in this disposable
  // fixture, after a human reports recovery or the host observes restored access.
  // Product decisions and authentication are never answered automatically.
  if (task.status === 'awaiting_input' && (process.argv.includes('--extension-ui-cleared') || process.argv.includes('--browser-restored'))) {
    const pending = task.clarifications?.find(item => !item.answers);
    const allowed = process.argv.includes('--browser-restored') ? ['dismiss_extension_ui', 'chrome_extension_block_recurred', 'restore_chrome_automation'] : ['dismiss_extension_ui', 'chrome_extension_block_recurred'];
    if (!pending || pending.questions.length !== 1 || !allowed.includes(pending.questions[0].id)) throw new Error('Pertanyaan ini membutuhkan jawaban pengguna.');
    const answer = process.argv.includes('--browser-restored')
      ? 'Pengguna sudah membuka ulang Chrome untuk memulihkan koneksi, atau host sudah mengamati akses yang pulih. Lanjutkan seluruh kriteria melalui Chrome dengan API yang didokumentasikan. Jika tab lama telah hilang setelah Chrome dibuka ulang, buat tab milik QA yang baru pada TARGET URL. Jangan menyatakan lulus sebelum seluruh hasil benar-benar diamati.'
      : 'Pengguna menyatakan tidak ada panel/popup ekstensi, dan screenshot Chrome mengonfirmasi halaman Counter tampil normal. Host juga berhasil memakai API Chrome yang didokumentasikan: Network.enable, readEvents, klik Tambah, dan Network.getResponseBody mengembalikan {value:1}. Periksa keadaan tab dan pesan error tool yang sebenarnya; jangan menganggap ada popup tanpa bukti. Lanjutkan seluruh kriteria melalui tab milik QA, mengikuti dokumentasi API.';
    runner.answer(task.id, pending.id, { [pending.questions[0].id]: answer });
  }
  const deadline = Date.now() + 45 * 60000;
  while (!['done', 'needs_attention', 'failed', 'stopped', 'awaiting_input'].includes(task.status)) {
    const status = `${task.status}: ${task.stages.filter(s => s.status === 'working').map(s => s.role).join(',')} · ${task.inputTokens + task.outputTokens} token · revisi ${task.retry}`;
    if (status !== last) { console.log(status); last = status; }
    if (Date.now() > deadline) { runner.action(task.id, 'stop'); throw new Error('Uji provider melewati batas waktu.'); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await writeFile('output/gpt-office/live-pipeline.json', JSON.stringify(task, null, 2));
  await cp(task.workspace, 'output/gpt-office/live-verified-reports', { recursive: true });
  console.log(JSON.stringify({ status: task.status, error: task.error, stages: task.stages, evidence: task.browserEvidence, clarifications: task.clarifications, usage: task.usage }, null, 2));
  if (task.status !== 'done') process.exitCode = 1;
} finally { await runner.shutdown(); store.close(); await rm(root, { recursive: true, force: true }); }
