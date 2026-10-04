import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RpcEvent { method?: string; id?: number | string; params?: any; result?: any; error?: { code?: number; message: string }; }
// One private stdio process per retained role session. It shares login, never the desktop's active chat.
export class CodexRpc {
  private child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<(event: RpcEvent) => void>();
  private stderr = '';
  private ended = false;
  private closing?: Promise<void>;
  private exited: Promise<void>;
  constructor(browser = false, executable = process.env.AGENT_TOWN_CODEX_EXECUTABLE || 'codex') {
    let plugins: string[] = [];
    try { plugins = [...readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8').matchAll(/\[plugins\."([^"]+)"\]/g)].map(match => match[1]); } catch {}
    const browserPlugins = ['chrome@openai-bundled', 'browser@openai-bundled', 'unified-computer-use@openai-bundled'];
    const settings = [
      // CLI dotted keys are split literally, including quotes. Override the
      // whole TOML table so plugin IDs remain exact and unused tools stay off.
      `plugins={${plugins.map(id => `${JSON.stringify(id)}={enabled=${browser && browserPlugins.includes(id)}}`).join(',')}}`,
      'features.apps=false',
      `mcp_servers.node_repl.enabled=${browser}`,
      'features.multi_agent=false', 'model_reasoning_effort="medium"', 'analytics.enabled=false',
    ];
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://', ...settings.flatMap(value => ['-c', value])], { env: process.env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => { this.child.once('close', () => resolve()); this.child.once('error', () => resolve()); });
    this.child.stderr.setEncoding('utf8'); this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('close', code => this.fail(new Error(`Codex berhenti (exit ${code}). ${this.stderr}`.trim())));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      if (line.length > 8_000_000) { this.fail(new Error('Output Codex terlalu besar.')); void this.close(); return; }
      let event: RpcEvent; try { event = JSON.parse(line); } catch { return; }
      if (!event.method && typeof event.id === 'number' && this.pending.has(event.id)) {
        const call = this.pending.get(event.id)!; this.pending.delete(event.id); clearTimeout(call.timer);
        event.error ? call.reject(new Error(event.error.message)) : call.resolve(event.result); return;
      }
      for (const listener of this.listeners) listener(event);
    });
  }
  async initialize() {
    await this.call('initialize', { clientInfo: { name: 'agent_town_gpt', title: 'Agent Town GPT', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  subscribe(listener: (event: RpcEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  send(value: RpcEvent) { if (!this.ended) this.child.stdin.write(JSON.stringify(value) + '\n'); }
  call(method: string, params: unknown, timeout = 20000): Promise<any> {
    if (this.ended) return Promise.reject(new Error('Sesi Codex sudah ditutup.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} melewati batas waktu.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  private fail(error: Error) {
    if (this.ended) return; this.ended = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'connection/closed', params: { error: error.message } });
  }
  private kill(signal: NodeJS.Signals) { try { if (this.child.pid) process.platform === 'win32' ? this.child.kill(signal) : process.kill(-this.child.pid, signal); } catch {} }
  close() {
    return this.closing ||= (async () => {
      this.fail(new Error('Sesi Codex ditutup.')); this.child.stdin.end(); this.kill('SIGTERM');
      const force = setTimeout(() => this.kill('SIGKILL'), 1000); await this.exited; clearTimeout(force); this.kill('SIGKILL');
    })();
  }
}
