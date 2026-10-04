// Usage report: total usage until a task ended, including revisions.
// Run with: npm run usage [-- <jumlah tugas>]
import path from 'node:path';
import { Store } from '../server/store.js';
import { AGENTS, type UsageRecord } from '../shared/types.js';

const limit = Number(process.argv[2]) || 8;
const store = new Store(path.resolve('.agent-town', 'office.sqlite'));
const number = (value: number) => Math.round(value).toLocaleString('id-ID');
// Rough API price weights relative to fresh input: cache write 1.25, cache read 0.1, output 5.
// An index for comparing runs of the same model, not a bill.
const index = (item: UsageRecord) => item.inputTokens - item.cacheWriteTokens + 1.25 * item.cacheWriteTokens + 0.1 * item.cacheReadTokens + 5 * item.outputTokens;
const total = (items: UsageRecord[]) => ({
  calls: items.length, lost: items.filter(item => item.measured === false).length,
  counted: items.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0),
  cacheRead: items.reduce((sum, item) => sum + item.cacheReadTokens, 0),
  output: items.reduce((sum, item) => sum + item.outputTokens, 0),
  index: items.reduce((sum, item) => sum + index(item), 0),
  minutes: items.reduce((sum, item) => sum + item.durationMs, 0) / 60000,
  turns: items.reduce((sum, item) => sum + (item.turns || 0), 0),
});

for (const task of store.all().filter(item => item.mode === 'claude').slice(0, limit).reverse()) {
  const usage = task.usage || [], all = total(usage);
  const native = task.nativeRoles?.length ? task.nativeRoles.map(role => AGENTS.find(agent => agent.id === role)!.name).join(', ') : 'tidak ada';
  console.log(`\n${task.title.slice(0, 70)}`);
  console.log(`  status ${task.status} · jalur ${task.plan?.kind || '-'} · revisi ${task.retry} · uji cara kerja bawaan: ${native}`);
  console.log(`  total: ${all.calls} panggilan (${all.lost} hangus) · tercatat ${number(all.counted)} · cache dibaca ${number(all.cacheRead)} · output ${number(all.output)} · indeks ${number(all.index)} · ${all.minutes.toFixed(1)} menit`);
  for (const agent of AGENTS) {
    const own = usage.filter(item => item.role === agent.id);
    if (!own.length) continue;
    const sum = total(own), models = [...new Set(own.map(item => item.model.replace('claude-', '')))].join('+');
    const marks = [own.some(item => item.native) && 'bawaan', own.some(item => item.chrome) && 'browser', own.some(item => item.resumed) && `${own.filter(item => item.resumed).length} lanjut sesi`].filter(Boolean).join(', ');
    console.log(`    ${agent.name.padEnd(8)} ${String(sum.calls).padStart(2)} panggilan${sum.turns ? ` (${sum.turns} giliran)` : ''} · tercatat ${number(sum.counted).padStart(9)} · cache dibaca ${number(sum.cacheRead).padStart(11)} · indeks ${number(sum.index).padStart(9)} · ${models}${marks ? ` · ${marks}` : ''}`);
  }
}
console.log('\nIndeks = perkiraan bobot harga API (cache tulis 1,25 · cache baca 0,1 · output 5) untuk membandingkan tugas dengan model yang sama; bukan angka tagihan.');
store.close();
