import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalBrowserRuntime } from './local-verification.js';
import Ajv, { type ValidateFunction } from 'ajv';
import type { ApiContract, Task } from '../shared/types.js';
import { ensureSafePath } from './files.js';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
interface Endpoint { method: string; pattern: RegExp; parameters: number; request: ValidateFunction; responses: Map<number, ValidateFunction>; }
export class ProjectRuntimeError extends Error {}
export function compileContract(contract: ApiContract): Endpoint[] {
  if (!contract.endpoints.length) throw new Error('Kontrak API tidak boleh kosong untuk project backend.');
  const ajv = new Ajv({ strict: false, allErrors: true });
  const seen = new Set<string>();
  return contract.endpoints.map(endpoint => {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method) || !/^\/api\/[\w/:-]+$/.test(endpoint.path)) throw new Error('Metode atau path kontrak API tidak valid.');
    const pattern = new RegExp('^' + endpoint.path.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$');
    const key = `${endpoint.method} ${pattern.source}`;
    if (seen.has(key) || !endpoint.responses.length) throw new Error('Endpoint duplikat atau tidak punya schema respons.');
    seen.add(key);
    const statuses = new Set<number>();
    for (const response of endpoint.responses) {
      if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) throw new Error('Status respons HTTP tidak valid.');
      if (statuses.has(response.status)) throw new Error('Schema respons dengan status duplikat.');
      statuses.add(response.status);
    }
    return { method: endpoint.method, pattern, parameters: endpoint.path.split('/').filter(part => part.startsWith(':')).length, request: ajv.compile(endpoint.requestSchema), responses: new Map(endpoint.responses.map(response => [response.status, ajv.compile(response.schema)])) };
  }).sort((left, right) => left.parameters - right.parameters);
}

export class ProjectRuntime {
  url = '';
  contractFailures: string[] = [];
  observedRequests: { method: string; path: string; endpoint?: string }[] = [];
  caseRequests: { method: string; path: string }[] = [];
  private server?: Server;
  private worker?: ChildProcess;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private endpoints: Endpoint[] = [];
  private data = '';
  private closed = false;
  constructor(private task: Task, private isolated: boolean) {}
  async start() {
    this.closed = false;
    const root = await realpath(this.task.workspace);
    this.data = path.join(root, this.isolated ? '.qa-data' : 'data');
    if (this.isolated) await rm(this.data, { recursive: true, force: true });
    await mkdir(this.data, { recursive: true });
    if (this.task.plan?.needsBackend) {
      if (!this.task.contract) throw new Error('Kontrak API belum tersedia.');
      this.endpoints = compileContract(this.task.contract);
      await ensureSafePath(root, 'backend/app.mjs');
      try { await this.startWorker(root); } catch (error) { throw new ProjectRuntimeError(`Backend gagal mulai: ${(error as Error).message}`); }
    }
    const allowedFiles = new Set(this.task.files.filter(file => file.role === 'frontend').map(file => file.path));
    this.server = createServer(async (req, res) => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
      try {
        const target = new URL(req.url || '/', this.url);
        if (target.pathname.startsWith('/api/')) {
          const observed: { method: string; path: string; endpoint?: string } = { method: req.method || 'GET', path: target.pathname };
          this.observedRequests.push(observed);
          this.caseRequests.push(observed);
          const origin = req.headers.origin;
          if ((origin && origin !== this.url) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: { code: 'ORIGIN_REJECTED', message: 'Origin tidak diizinkan.' } });
          const endpoint = this.endpoints.find(item => item.method === req.method && item.pattern.test(target.pathname));
          if (!endpoint) return json(404, { error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of req) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += data.length;
            if (bytes > 64000) return json(413, { error: { code: 'BODY_LIMIT', message: 'Request terlalu besar.' } });
            chunks.push(data);
          }
          const raw = Buffer.concat(chunks, bytes).toString('utf8');
          let body: unknown = {};
          try { if (raw) body = JSON.parse(raw); } catch { return json(400, { error: { code: 'INVALID_JSON', message: 'JSON tidak valid.' } }); }
          const query = Object.fromEntries(target.searchParams);
          if (!endpoint.request(req.method === 'GET' ? query : body)) return json(400, { error: { code: 'VALIDATION_ERROR', message: 'Request tidak sesuai kontrak.' } });
          observed.endpoint = endpoint.pattern.source;
          const result = await this.request({ method: req.method, path: target.pathname, query, body });
          const validation = result && endpoint.responses.get(result.status);
          if (!validation || !validation(result.body)) {
            this.contractFailures.push(`${req.method} ${target.pathname}: respons backend tidak sesuai kontrak.`);
            return json(500, { error: { code: 'CONTRACT_MISMATCH', message: 'Respons tidak sesuai kontrak API.' } });
          }
          return json(result.status, result.body);
        }
        if (!['GET', 'HEAD'].includes(req.method || 'GET')) return json(405, { error: 'Method tidak didukung.' });
        const relative = decodeURIComponent(target.pathname === '/' ? '/index.html' : target.pathname).slice(1);
        if (!allowedFiles.has(relative)) return json(404, { error: 'File tidak ditemukan.' });
        const content = await readFile(await ensureSafePath(root, relative));
        res.writeHead(200, { 'Content-Type': MIME[path.extname(relative)] || 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'" });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch (error) { if (!res.headersSent) json(500, { error: { code: 'RUNTIME_ERROR', message: String((error as Error).message) } }); else res.end(); }
    });
    const storedPort = this.task.previewPort;
    const preferredPort = !this.isolated && Number.isInteger(storedPort) && storedPort! >= 1024 && storedPort! <= 65535 ? storedPort! : 0;
    try { await this.listen(preferredPort); }
    catch (error) {
      if (!preferredPort || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      // If another process owns the old port, never connect the preview to it.
      await this.listen(0);
    }
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Runtime gagal menentukan port.');
    if (!this.isolated) this.task.previewPort = address.port;
    this.url = `http://127.0.0.1:${address.port}`;
    return this;
  }
  private listen(port: number) {
    const server = this.server!;
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.removeListener('error', onError); reject(error); };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', onError); resolve(); });
    });
  }
  private startWorker(root: string) {
    const host = fileURLToPath(new URL('./backend-host.mjs', import.meta.url));
    return new Promise<void>((resolve, reject) => {
      const worker = this.worker = spawn(process.execPath, ['--permission', `--allow-fs-read=${host}`, `--allow-fs-read=${path.join(root, 'backend')}`, `--allow-fs-read=${this.data}`, `--allow-fs-write=${this.data}`, '--experimental-vm-modules', host, root, this.data], { cwd: root, env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let stderr = '';
      const timer = setTimeout(() => { worker.kill('SIGKILL'); reject(new Error('Backend gagal mulai dalam 5 detik.')); }, 5000);
      worker.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-2000); });
      worker.on('message', (message: any) => {
        if (message.ready) { clearTimeout(timer); resolve(); }
        if (message.startupError) { clearTimeout(timer); reject(new Error(message.startupError)); }
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
      });
      const exited = (error: Error) => { clearTimeout(timer); reject(error); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); };
      worker.on('error', exited);
      worker.on('exit', () => exited(new Error(stderr || 'Runtime backend berhenti.')));
    });
  }
  private request(request: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker?.connected) return reject(new Error('Backend tidak tersedia.'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); this.worker?.kill('SIGKILL'); reject(new Error('Backend melewati batas waktu request.')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.send({ id, request }, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  async resetTestData() { if (this.isolated) await rm(path.join(this.data, 'store.json'), { force: true }); }
  async seedTestData(value: string) {
    if (!this.isolated || value.length > 64000) throw new Error('Seed hanya tersedia untuk data QA, maksimal 64KB.');
    JSON.parse(value); await writeFile(path.join(this.data, 'store.json'), value);
  }
  async stop() {
    if (this.closed) return; this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Runtime dihentikan.')); } this.pending.clear();
    this.worker?.kill('SIGKILL');
    if (this.server) await new Promise<void>(resolve => { this.server!.close(() => resolve()); this.server!.closeAllConnections(); });
    if (this.isolated && this.data) await rm(this.data, { recursive: true, force: true });
  }
}

export class PreviewManager {
  private runtimes = new Map<string, ProjectRuntime | LocalBrowserRuntime>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;
  private operations: Promise<void> = Promise.resolve();
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operations.then(operation);
    // A failed startup must not block subsequent close/open operations.
    this.operations = pending.then(() => {}, () => {});
    return pending;
  }
  open(task: Task) {
    if (this.closing) return Promise.reject(new Error('Preview kantor sedang ditutup.'));
    return this.enqueue(async () => {
      if (this.closing) throw new Error('Preview kantor sedang ditutup.');
      await this.closeRuntime(task.id);
      if (this.runtimes.size >= 3) await this.closeRuntime(this.runtimes.keys().next().value!);
      const runtime = task.access === 'local' ? new LocalBrowserRuntime(task, new AbortController().signal, () => {}) : new ProjectRuntime(task, false);
      try {
        await runtime.start();
        if (this.closing) throw new Error('Preview kantor sedang ditutup.');
      } catch (error) { await runtime.stop(); throw error; }
      this.runtimes.set(task.id, runtime);
      const timer = setTimeout(() => { void this.close(task.id); }, 20 * 60 * 1000); timer.unref(); this.timers.set(task.id, timer);
      return runtime.url;
    });
  }
  private async closeRuntime(id: string) {
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    const runtime = this.runtimes.get(id); this.runtimes.delete(id);
    await runtime?.stop();
  }
  close(id: string) { return this.enqueue(() => this.closeRuntime(id)); }
  shutdown() {
    this.closing = true;
    return this.enqueue(async () => { await Promise.all([...this.runtimes.keys()].map(id => this.closeRuntime(id))); });
  }
}
