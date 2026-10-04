import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askDemo, type AskEngine } from '../../server/engine.js';
import { createOfficeApp } from '../../server/app.js';
import type { EngineHealth } from '../../shared/types.js';

export const fixtureHealth: EngineHealth = { installed: true, loggedIn: true, provider: 'Local test fixture', version: 'Simulasi lokal · tanpa Claude' };
export function simulatedEngine(delayMs = 0) {
  const calls: { task: string; role: string; phase: string }[] = [];
  const engine: AskEngine = async request => {
    calls.push({ task: request.task.id, role: request.role, phase: request.phase || 'work' });
    if (delayMs) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('Fixture stopped')); };
      const timer = setTimeout(() => { request.signal.removeEventListener('abort', abort); resolve(); }, delayMs);
      if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true });
    });
    const result = await askDemo(request);
    const answered = request.task.clarifications?.filter(item => item.answers) || [];
    if (request.task.prompt.includes('Klarifikasi') && request.role === 'ceo' && !answered.length) {
      result.output.questions = [{ id: 'choice', question: 'Penyimpanan catatan di mana?', options: ['Browser', 'Server'] }];
    }
    if (request.task.prompt.includes('Dua klarifikasi') && request.role === 'frontend' && !answered.some(item => item.role === 'frontend')) {
      result.output.questions = [{ id: 'choice', question: 'Warna tombol mengikuti tema mana?', options: ['Hijau', 'Amber'] }];
    }
    return result;
  };
  return { engine, calls };
}

export function fixtureOffice(folder: string, engine: AskEngine) {
  return createOfficeApp({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    workspaceRoot: path.join(folder, 'projects'), databasePath: path.join(folder, 'office.sqlite'),
    localRoot: folder,
    logger: false, engine, demoEngine: engine, health: fixtureHealth,
    checkHealth: async () => fixtureHealth,
  });
}

export async function eventually(check: () => boolean | Promise<boolean>, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for office state');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
