import { mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Artifact, Check, RoleId } from '../shared/types.js';

const EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.png']);
export function safePath(root: string, relative: string) {
  if (!relative || relative.length > 200 || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p.startsWith('.'))) throw new Error('Nama file di luar folder project ditolak.');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep) || !EXTENSIONS.has(path.extname(relative).toLowerCase())) throw new Error('Jenis atau lokasi file tidak didukung.');
  return resolved;
}

export async function ensureSafePath(root: string, relative: string) {
  const target = safePath(root, relative);
  const rootReal = await realpath(root);
  let probe = target;
  while (probe !== path.resolve(root)) {
    try {
      const info = await lstat(probe);
      if (info.isSymbolicLink()) throw new Error('Symlink tidak didukung di folder hasil kerja.');
      const probeReal = await realpath(probe);
      if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) throw new Error('Lokasi file di luar project.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    probe = path.dirname(probe);
  }
  return target;
}

export async function saveFiles(root: string, files: { path: string; content: string }[], role: RoleId): Promise<Artifact[]> {
  if (files.length > 16) throw new Error('Maksimal 16 file per tahap.');
  const prepared = await Promise.all(files.map(async file => {
    if (typeof file.content !== 'string' || Buffer.byteLength(file.content) > 200_000) throw new Error('File terlalu besar.');
    return { ...file, target: await ensureSafePath(root, file.path) };
  }));
  const total = prepared.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
  if (total > 800_000) throw new Error('Hasil tahap terlalu besar.');
  const output: Artifact[] = [];
  for (const file of prepared) {
    await mkdir(path.dirname(file.target), { recursive: true });
    await writeFile(file.target, file.content, 'utf8');
    output.push({ path: file.path, bytes: Buffer.byteLength(file.content), role });
  }
  return output;
}

export function validateOwnership(role: RoleId, files: { path: string; content: string }[]) {
  const unique = new Set<string>();
  for (const file of files) {
    if (unique.has(file.path)) throw new Error('Hasil berisi path file duplikat.');
    unique.add(file.path);
    const allowed = role === 'frontend' ? (file.path === 'index.html' || /^frontend\/[\w/-]+\.(css|m?js|svg)$/.test(file.path))
      : role === 'backend' ? /^backend\/[\w/-]+\.m?js$/.test(file.path)
      : role === 'designer' ? file.path === 'DESIGN-SYSTEM.md' : false;
    if (!allowed) throw new Error(`${role} tidak memiliki file ${file.path}. Ikuti konvensi proyek.`);
  }
}

export async function syntaxChecks(root: string, files: Artifact[]): Promise<Check[]> {
  const checks: Check[] = [];
  const index = files.find(f => f.path === 'index.html');
  checks.push({ name: 'Halaman utama', passed: !!index, detail: index ? 'index.html tersedia.' : 'Frontend belum membuat index.html.' });
  if (index) {
    const html = await readFile(await ensureSafePath(root, 'index.html'), 'utf8');
    checks.push({ name: 'Struktur HTML', passed: /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html) && /<title[\s>]/i.test(html), detail: 'Memeriksa elemen html, body, dan title.' });
    checks.push({ name: 'Viewport mobile', passed: /name\s*=\s*["']viewport["']/i.test(html), detail: 'Memeriksa meta viewport.' });
    let i = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=|application\/ld\+json|application\/json/i.test(match[1])) continue;
      const temp = path.join(root, `.qa-inline-${i++}.mjs`);
      await writeFile(temp, match[2]);
      try { checks.push(await checkJs(temp, `JavaScript inline ${i}`)); }
      finally { const { unlink } = await import('node:fs/promises'); await unlink(temp); }
    }
  }
  for (const file of files.filter(f => /\.(m?js)$/.test(f.path))) checks.push(await checkJs(await ensureSafePath(root, file.path), `Sintaks ${file.path}`));
  for (const file of files.filter(f => /\.json$/.test(f.path))) {
    try { JSON.parse(await readFile(await ensureSafePath(root, file.path), 'utf8')); checks.push({ name: `JSON ${file.path}`, passed: true, detail: 'JSON valid.' }); }
    catch (error) { checks.push({ name: `JSON ${file.path}`, passed: false, detail: String((error as Error).message) }); }
  }
  return checks;
}

function checkJs(file: string, name: string): Promise<Check> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 2000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('error', error => { clearTimeout(timer); resolve({ name, passed: false, detail: error.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ name, passed: code === 0, detail: code === 0 ? 'Sintaks valid; kode tidak dieksekusi oleh pemeriksaan ini.' : stderr || 'Pemeriksaan tidak selesai.' }); });
  });
}

export async function buildPreview(root: string, files: Artifact[]) {
  let html = await readFile(await ensureSafePath(root, 'index.html'), 'utf8');
  const known = new Set(files.map(f => f.path));
  // Only inline files produced by this job. A sandboxed iframe receives no app credentials.
  const cssLinks = [...html.matchAll(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi)];
  for (const match of cssLinks) {
    const relative = match[1].replace(/^\.\//, '');
    if (known.has(relative)) html = html.replace(match[0], `<style>${(await readFile(await ensureSafePath(root, relative), 'utf8')).replace(/<\/style/gi, '<\\/style')}</style>`);
  }
  const jsLinks = [...html.matchAll(/<script\b[^>]*src=["']([^"']+\.m?js)["'][^>]*>\s*<\/script>/gi)];
  for (const match of jsLinks) {
    const relative = match[1].replace(/^\.\//, '');
    if (known.has(relative)) html = html.replace(match[0], `<script>${(await readFile(await ensureSafePath(root, relative), 'utf8')).replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  return html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}
