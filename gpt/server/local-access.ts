import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Task } from '../shared/types.js';

export async function workingDirectory(value: string, base: string) {
  if (!value.trim() || value.length > 4096 || value.includes('\0')) throw new Error('Lokasi folder tidak valid.');
  const expanded = value === '~' ? homedir() : value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value;
  const directory = await realpath(path.resolve(base, expanded));
  if (!(await stat(directory)).isDirectory()) throw new Error('Lokasi kerja harus berupa folder.');
  return directory;
}

export async function listDirectories(value: string, base: string) {
  const directory = await workingDirectory(value, base);
  const names = await readdir(directory, { withFileTypes: true });
  const folders = await Promise.all(names.map(async entry => {
    const location = path.join(directory, entry.name);
    try {
      if (entry.isDirectory() || entry.isSymbolicLink() && (await stat(location)).isDirectory()) return { name: entry.name, path: location };
    } catch { /* A broken or unreadable symlink is not a selectable folder. */ }
  }));
  const entries = folders.filter((entry): entry is { name: string; path: string } => !!entry).sort((a, b) => a.name.localeCompare(b.name));
  return { path: directory, parent: path.dirname(directory), entries: entries.slice(0, 500), truncated: entries.length > 500 };
}

export async function projectFile(task: Task, value: string) {
  if (task.access !== 'local' || !task.projectPath) throw new Error('Tugas ini tidak memakai akses laptop.');
  if (!value || value.length > 4096 || value.includes('\0')) throw new Error('Lokasi file tidak valid.');
  const file = await realpath(path.resolve(task.projectPath, value));
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Lokasi bukan file.');
  if (info.size > 800_000) throw new Error('File terlalu besar untuk ditampilkan (maksimal 800KB).');
  return file;
}
