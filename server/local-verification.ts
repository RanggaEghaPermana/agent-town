import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { BrowserEvidence, Check, Task, TerminalCase } from '../shared/types.js';
import type { BrowserReport } from './browser-qa.js';

export interface CommandResult { passed: boolean; output: string; exitCode: number | null; }
export class LocalProjectRuntimeError extends Error {}
export function runCommand(command: string, cwd: string, signal: AbortSignal, onOutput: (text: string) => void, timeout = 120000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Pekerjaan dihentikan.')); return; }
    const child = spawn('/bin/bash', ['-lc', command], { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', reason: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, kind); } catch {} };
    const terminate = (error: Error) => { if (reason) return; reason = error; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 1000); };
    const abort = () => terminate(new Error('Pekerjaan dihentikan.'));
    const timer = setTimeout(() => terminate(new Error('Perintah pengujian melewati batas waktu.')), timeout);
    signal.addEventListener('abort', abort, { once: true });
    for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', text => { output = (output + text).slice(-32000); onOutput(text); }); }
    child.on('error', error => { reason = error; });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort); kill('SIGKILL');
      if (signal.aborted) reject(reason || new Error('Pekerjaan dihentikan.'));
      else resolve({ passed: !reason && code === 0, exitCode: code, output: reason ? `${reason.message}\n${output}` : output });
    });
  });
}

export async function terminalQA(task: Task, signal: AbortSignal, onEvent: (text: string) => void): Promise<BrowserReport> {
  const tests = task.localVerification?.terminalTests || [];
  const ids = new Set<string>();
  if (!tests.length || tests.length > 40) throw new Error('QA terminal harus menyediakan 1–40 skenario.');
  for (const test of tests) {
    if (!test.id || ids.has(test.id) || !test.command.trim() || test.command.length > 6000 || !task.criteria?.some(criterion => criterion.id === test.criterionId)) throw new Error('Skenario terminal tidak valid atau tidak mengacu pada kriteria project.');
    ids.add(test.id);
  }
  if (task.criteria?.some(criterion => ['responsive', 'motion'].includes(criterion.category))) throw new Error('Kriteria UI/motion wajib diuji di browser.');
  const checks: Check[] = (task.criteria || []).map(criterion => ({ name: `Cakupan ${criterion.id}`, passed: tests.some(test => test.criterionId === criterion.id), detail: criterion.description }));
  const evidence: BrowserEvidence[] = [];
  for (const test of tests) {
    signal.throwIfAborted(); onEvent(`${test.title} → ${test.command}`);
    const result = await runCommand(test.command, task.projectPath!, signal, text => onEvent(text.slice(-4000)));
    const detail = `Exit ${result.exitCode}: ${result.output || '(tanpa output)'}`;
    evidence.push({ id: test.id, criterionId: test.criterionId, title: test.title, passed: result.passed, detail, steps: [{ action: 'terminal', passed: result.passed, detail }] });
    checks.push({ name: test.title, passed: result.passed, detail });
  }
  return { checks, evidence, images: [] };
}

async function freePort(preferred = 0): Promise<number> {
  const server = createServer();
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(preferred, '127.0.0.1', resolve); }); }
  catch (error) { if (preferred && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') return freePort(); throw error; }
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export class LocalBrowserRuntime {
  url = '';
  readonly external = true;
  observedRequests: { method: string; path: string; endpoint?: string }[] = [];
  caseRequests: { method: string; path: string; endpoint?: string }[] = [];
  contractFailures: string[] = [];
  private stopProcess?: () => Promise<void>;
  constructor(private task: Task, private signal: AbortSignal, private onEvent: (text: string) => void) {}
  async start() {
    const verification = this.task.localVerification;
    if (!verification || verification.kind === 'terminal') throw new Error('Konfigurasi QA browser project belum tersedia.');
    const port = verification.serverCommand ? await freePort(this.task.previewPort || 0) : undefined;
    // Agents write the port placeholder in several spellings; accept the shell forms as well as {port}.
    const address = verification.url?.replace(/\{port\}|\$\{?(?:AGENT_TOWN_PREVIEW_PORT|PORT)\}?/g, String(port ?? '')) || (port ? `http://127.0.0.1:${port}` : '');
    let url: URL;
    try { url = new URL(address); } catch { throw new LocalProjectRuntimeError(`URL verifikasi tidak valid: ${verification.url || '(kosong)'}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL browser harus HTTP/HTTPS tanpa kredensial di URL.');
    this.url = url.href.replace(/\/$/, '');
    if (verification.serverCommand) {
      const child = spawn('/bin/bash', ['-lc', verification.serverCommand], { cwd: this.task.projectPath, env: { ...process.env, PORT: String(port), AGENT_TOWN_PREVIEW_PORT: String(port) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let exited = false, startupError = '';
      const closed = new Promise<void>(resolve => { child.on('close', () => { exited = true; resolve(); }); child.on('error', error => { startupError = error.message; }); });
      const kill = (kind: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, kind); } catch {} };
      this.stopProcess = async () => { kill('SIGTERM'); const timer = setTimeout(() => kill('SIGKILL'), 1000); await closed; clearTimeout(timer); kill('SIGKILL'); };
      for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', text => { startupError = (startupError + text).slice(-4000); this.onEvent(text.slice(-1000)); }); }
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        this.signal.throwIfAborted();
        if (exited) throw new LocalProjectRuntimeError(`Server project gagal mulai: ${startupError}`);
        try { await fetch(this.url, { signal: AbortSignal.timeout(2000) }); this.task.previewPort = port; return this; } catch {}
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new LocalProjectRuntimeError(`Server project belum tersedia setelah 60 detik. ${startupError}`);
    }
    return this;
  }
  async resetTestData() { /* Existing application data is prepared through its own UI/API. */ }
  async seedTestData(_value: string) { throw new Error('seedData tidak tersedia untuk project laptop. Gunakan fixture/API/UI aplikasi yang sebenarnya.'); }
  observe(method: string, address: string) {
    const url = new URL(address);
    if (url.origin !== new URL(this.url).origin) return;
    const observation = { method, path: url.pathname };
    this.observedRequests.push(observation); this.caseRequests.push(observation);
  }
  async stop() { await this.stopProcess?.(); this.stopProcess = undefined; }
}
