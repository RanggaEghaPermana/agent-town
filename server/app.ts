import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import serveStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { WebSocket } from 'ws';
import { ROLE_ORDER, type EngineHealth, type RoleId } from '../shared/types.js';
import type { AskEngine } from './engine.js';
import type { OpenBrowser } from './browser-qa.js';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { engineHealth } from './engine.js';
import { ensureSafePath } from './files.js';
import { PreviewManager } from './runtime.js';
import { listDirectories, projectFile } from './local-access.js';

export interface OfficeAppOptions {
  root?: string;
  workspaceRoot?: string;
  localRoot?: string;
  databasePath?: string;
  logger?: boolean;
  engine?: AskEngine;
  demoEngine?: AskEngine;
  browser?: OpenBrowser;
  health?: EngineHealth;
  checkHealth?: () => Promise<EngineHealth>;
}

export async function createOfficeApp(options: OfficeAppOptions = {}) {
  const root = options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const workspaces = path.resolve(options.workspaceRoot || process.env.AGENT_TOWN_WORKSPACE || path.join(root, 'projects'));
  await mkdir(workspaces, { recursive: true });
  const store = new Store(options.databasePath || path.join(root, '.agent-town', 'office.sqlite'));
  const app = Fastify({ bodyLimit: 16_000, logger: options.logger ?? true });
  const clients = new Set<WebSocket>();
  const previews = new PreviewManager();
  const runner = new Runner(store, workspaces, state => {
    const message = JSON.stringify({ type: 'state', state });
    for (const client of clients) if (client.readyState === 1) client.send(message);
  }, options.engine, options.demoEngine, options.browser, options.localRoot || path.dirname(root));
  if (options.health) runner.health = options.health;
  const checkHealth = options.checkHealth || engineHealth;
  const allowed = new Set(['http://127.0.0.1:5178', 'http://localhost:5178']);

  app.addHook('onRequest', async (req, reply) => {
    if (!(req.url.startsWith('/api/') || req.url.startsWith('/ws'))) return;
    let hostname = '';
    try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch {}
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return reply.code(403).send({ error: 'Host harus localhost.' });
    const origin = req.headers.origin;
    const address = app.server.address();
    const port = address && typeof address !== 'string' ? address.port : undefined;
    const sameOffice = port !== undefined && (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`);
    if (origin && !sameOffice && !allowed.has(origin)) return reply.code(403).send({ error: 'Origin tidak diizinkan.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-agent-town'] !== '1') return reply.code(403).send({ error: 'Permintaan harus berasal dari aplikasi Agent Town.' });
  });
  app.setErrorHandler((error, _req, reply) => reply.code((error as { statusCode?: number }).statusCode || 400).send({ error: error instanceof Error ? error.message : 'Permintaan gagal.' }));
  await app.register(websocket);
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'state', state: runner.snapshot() }));
    socket.on('error', () => clients.delete(socket));
    socket.on('close', () => clients.delete(socket));
  });
  app.get('/api/state', () => runner.snapshot());
  app.get<{ Querystring: { path?: string } }>('/api/directories', async req => {
    if (req.query.path !== undefined && typeof req.query.path !== 'string') throw new Error('Lokasi folder tidak valid.');
    return listDirectories(req.query.path || runner.localRoot, runner.localRoot);
  });
  app.post('/api/health', async () => { runner.health = await checkHealth(); runner.changed(); return runner.health; });
  // Pasted screenshots travel as base64 inside the JSON body.
  const uploads = { bodyLimit: 45_000_000 };
  app.post('/api/tasks', uploads, async (req, reply) => {
    const body = req.body as { prompt?: unknown; mode?: unknown; tokenBudget?: unknown; access?: unknown; projectPath?: unknown; images?: unknown; nativeRoles?: unknown } | undefined;
    if (!body || typeof body.prompt !== 'string' || body.prompt.trim().length < 5 || body.prompt.length > 6000 || !['claude', 'demo'].includes(String(body.mode))) return reply.code(400).send({ error: 'Isi tugas 5–6000 karakter dan pilih mode yang valid.' });
    if (body.tokenBudget !== undefined && (typeof body.tokenBudget !== 'number' || !Number.isInteger(body.tokenBudget) || body.tokenBudget < 10000 || body.tokenBudget > 1000000)) return reply.code(400).send({ error: 'Batas token harus 10.000–1.000.000.' });
    if (body.access !== undefined && !['local', 'generated'].includes(String(body.access))) return reply.code(400).send({ error: 'Mode akses tidak valid.' });
    if (body.projectPath !== undefined && typeof body.projectPath !== 'string') return reply.code(400).send({ error: 'Lokasi folder tidak valid.' });
    if (body.nativeRoles !== undefined && (!Array.isArray(body.nativeRoles) || body.nativeRoles.some(role => !ROLE_ORDER.includes(role)))) return reply.code(400).send({ error: 'Peran untuk uji cara kerja bawaan tidak valid.' });
    return runner.create(body.prompt.trim(), body.mode as 'claude' | 'demo', body.tokenBudget as number | undefined, { access: body.access as 'local' | 'generated' | undefined, projectPath: body.projectPath as string | undefined, images: body.images, nativeRoles: body.nativeRoles as RoleId[] | undefined });
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/answer', uploads, (req, reply) => {
    const body = req.body as { clarificationId?: unknown; answers?: unknown; images?: unknown } | undefined;
    if (!body || typeof body.clarificationId !== 'string' || !body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return reply.code(400).send({ error: 'Jawaban klarifikasi tidak valid.' });
    return runner.answer(req.params.id, body.clarificationId, body.answers as Record<string, string>, body.images);
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/close-preview', async (req) => {
    await previews.close(req.params.id);
    const task = runner.tasks.find(item => item.id === req.params.id);
    if (task) { delete task.previewUrl; runner.changed(task); }
    return { closed: true };
  });
  app.post<{ Params: { id: string; action: string } }>('/api/tasks/:id/:action', uploads, (req, reply) => {
    if (!['pause', 'resume', 'stop', 'continue'].includes(req.params.action)) return reply.code(400).send({ error: 'Aksi tidak dikenal.' });
    return runner.action(req.params.id, req.params.action as 'pause' | 'resume' | 'stop' | 'continue', req.body as { note?: unknown; images?: unknown } | undefined);
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/tasks/:id/file', async (req, reply) => {
    const task = runner.tasks.find(t => t.id === req.params.id);
    const artifact = task?.files.find(f => f.path === req.query.path);
    if (!task || !artifact) return reply.code(404).send({ error: 'File tidak ditemukan.' });
    const file = await ensureSafePath(task.workspace, artifact.path);
    if ((await stat(file)).size > 800_000) return reply.code(413).send({ error: 'File terlalu besar.' });
    if (artifact.path.endsWith('.png')) return reply.code(400).send({ error: 'Gunakan endpoint evidence untuk gambar QA.' });
    return { path: artifact.path, content: await readFile(file, 'utf8') };
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/tasks/:id/project-file', async (req, reply) => {
    const task = runner.tasks.find(task => task.id === req.params.id);
    if (!task) return reply.code(404).send({ error: 'Tugas tidak ditemukan.' });
    const file = await projectFile(task, req.query.path);
    return { path: file, content: await readFile(file, 'utf8') };
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/tasks/:id/project-download', async (req, reply) => {
    const task = runner.tasks.find(task => task.id === req.params.id);
    if (!task) return reply.code(404).send({ error: 'Tugas tidak ditemukan.' });
    const file = await projectFile(task, req.query.path);
    reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    return reply.send(await readFile(file));
  });
  app.get<{ Params: { id: string } }>('/api/tasks/:id/preview', async (req, reply) => {
    const task = runner.tasks.find(t => t.id === req.params.id);
    if (!task || !(task.access === 'local' ? task.localVerification?.kind === 'browser' : task.files.some(f => f.path === 'index.html'))) return reply.code(404).send({ error: 'Halaman hasil belum tersedia.' });
    reply.header('Cache-Control', 'no-store');
    const url = await previews.open(task);
    task.previewUrl = url; runner.changed(task);
    return { url };
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/tasks/:id/evidence', async (req, reply) => {
    const task = runner.tasks.find(item => item.id === req.params.id);
    const artifact = task?.files.find(file => file.path === req.query.path && file.role === 'qa' && /^qa\/run-\d+\/(case-\d+|mobile)\.png$/.test(file.path));
    if (!task || !artifact) return reply.code(404).send({ error: 'Bukti QA tidak ditemukan.' });
    reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store');
    return reply.send(await readFile(await ensureSafePath(task.workspace, artifact.path)));
  });
  app.get<{ Params: { id: string }; Querystring: { path: string } }>('/api/tasks/:id/download', async (req, reply) => {
    const task = runner.tasks.find(t => t.id === req.params.id);
    const artifact = task?.files.find(f => f.path === req.query.path);
    if (!task || !artifact) return reply.code(404).send({ error: 'File tidak ditemukan.' });
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(artifact.path).replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    return reply.send(await readFile(await ensureSafePath(task.workspace, artifact.path)));
  });
  if (existsSync(path.join(root, 'dist', 'index.html'))) {
    await app.register(serveStatic, { root: path.join(root, 'dist') });
    app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Endpoint tidak ditemukan.' }) : reply.sendFile('index.html'));
  }

  app.addHook('preClose', async () => {
    await runner.shutdown();
    await previews.shutdown();
    for (const socket of clients) socket.close();
  });
  app.addHook('onClose', async () => { store.close(); });
  return { app, runner, previews };
}
