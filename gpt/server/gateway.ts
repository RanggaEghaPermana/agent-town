import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Transport wiring only: neither office's endpoints, runner nor database are combined.
export function createOfficeGateway(root: string, claude: string, gpt: string): Server {
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const target = (url: string) => url.startsWith('/gpt/api/') || url.startsWith('/gpt/ws') ? { base: gpt, url: url.slice(4) } : url.startsWith('/api/') || url.startsWith('/ws') ? { base: claude, url } : undefined;
  const authorized = (req: IncomingMessage) => {
    let hostname = '';
    try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { return false; }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
    if (!req.headers.origin) return true;
    const address = server.address();
    const port = address && typeof address !== 'string' ? address.port : undefined;
    return ['http://127.0.0.1:5178', 'http://localhost:5178', `http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin);
  };
  const server = createServer(async (req, res) => {
    const route = target(req.url || '/');
    if (route) {
      // Validate at the public gateway before translating its origin to the
      // private office server. Preserve the original office's localhost gate.
      if (!authorized(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Host atau origin kantor tidak diizinkan.' })); return; }
      const url = new URL(route.url, route.base);
      const forward = request(url, { method: req.method, headers: { ...req.headers, host: url.host, ...(req.headers.origin ? { origin: url.origin } : {}) } }, upstream => { res.writeHead(upstream.statusCode || 502, upstream.headers); upstream.pipe(res); });
      forward.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Kantor belum terhubung. Jalankan kedua server kantor.' })); });
      req.pipe(forward); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) { res.writeHead(403); res.end(); return; }
      if (pathname === '/' || !(await stat(file).catch(() => undefined))?.isFile()) file = path.join(root, 'index.html');
      const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data);
    } catch { res.writeHead(404); res.end('Build belum tersedia. Jalankan npm run build.'); }
  });
  server.on('upgrade', (req, socket, head) => {
    const route = target(req.url || ''); if (!route) { socket.destroy(); return; }
    if (!authorized(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const url = new URL(route.url, route.base);
    const forward = request(url, { headers: { ...req.headers, host: url.host, ...(req.headers.origin ? { origin: url.origin } : {}) } });
    forward.on('upgrade', (upstream, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${upstream.statusCode} ${upstream.statusMessage}\r\n${Object.entries(upstream.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (remoteHead.length) socket.write(remoteHead); if (head.length) remote.write(head);
      remote.pipe(socket); socket.pipe(remote); socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy()); socket.on('close', () => remote.destroy());
    });
    forward.on('error', () => socket.destroy()); forward.end();
  });
  return server;
}
