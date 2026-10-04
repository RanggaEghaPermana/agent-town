// Manual integration check: invokes the logged-in Claude provider and uses tokens.
// Run explicitly with: npx tsx scripts/verify-local-access.ts
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOfficeApp } from '../server/app.js';
import { engineHealth } from '../server/engine.js';

const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-real-access-'));
const project = path.join(root, 'existing-repo');
await mkdir(path.join(project, 'lib'), { recursive: true });
await writeFile(path.join(project, 'lib/math.mjs'), 'export const double = n => n * 3;\n');
await writeFile(path.join(project, 'README.md'), 'Keep the existing project layout and this documentation.\n');
await writeFile(path.join(root, 'shared-marker.txt'), 'fixture marker outside project cwd\n');
const office = await createOfficeApp({ workspaceRoot: path.join(root, 'reports'), databasePath: path.join(root, 'office.sqlite'), localRoot: project, logger: false, health: await engineHealth() });
try {
  const task = await office.runner.create('Di project fixture ini, perbaiki fungsi double di lib/math.mjs: double(n) harus n * 2, termasuk angka negatif dan nol. Baca ../shared-marker.txt lalu buat ../shared-proof.txt dengan isi marker yang sama untuk membuktikan akses di luar cwd. Pertahankan README.md dan struktur project. Ini modul Node non-web, tanpa UI/API/dependensi baru; QA wajib menjalankan assertion Node untuk ketiga nilai (4 menjadi 8, -3 menjadi -6, 0 menjadi 0) serta isi shared-proof.txt. Gunakan akses file dan terminal nyata, jangan hanya mengembalikan kode sebagai laporan.', 'claude', 120000, { access: 'local', projectPath: project });
  let last = '';
  const deadline = Date.now() + 600000;
  while (!['done', 'needs_attention', 'awaiting_input', 'stopped'].includes(task.status)) {
    const progress = task.stages.map(stage => `${stage.role}:${stage.status}`).join(' ');
    if (progress !== last) { console.log(progress); last = progress; }
    if (Date.now() > deadline) { office.runner.action(task.id, 'stop'); throw new Error('Real provider check timed out.'); }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const report = { taskId: task.id, status: task.status, error: task.error, projectPath: project, changedFiles: task.changedFiles, checks: task.checks, terminalEvidence: task.terminalEvidence, usage: task.usage, toolActivity: task.logs.filter(log => log.type === 'output').map(log => ({ role: log.role, text: log.text })) };
  await writeFile(path.resolve('output/local-access-real-provider.json'), JSON.stringify(report, null, 2));
  assert.equal(task.status, 'done', task.error || JSON.stringify(task.clarifications));
  assert.equal(await readFile(path.join(root, 'shared-proof.txt'), 'utf8'), await readFile(path.join(root, 'shared-marker.txt'), 'utf8'));
  assert.equal(await readFile(path.join(project, 'README.md'), 'utf8'), 'Keep the existing project layout and this documentation.\n');
  assert.ok(task.terminalEvidence?.length && task.terminalEvidence.every(item => item.passed));
  console.log(JSON.stringify({ status: task.status, calls: task.usage?.length, tokens: task.inputTokens + task.outputTokens, changedFiles: task.changedFiles }));
} finally { await office.app.close(); await rm(root, { recursive: true, force: true }); }
