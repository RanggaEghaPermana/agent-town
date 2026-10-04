import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task } from '../shared/types.js';

export class Store {
  private db: Database.Database;
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL)');
  }
  all(): Task[] { return this.db.prepare('SELECT payload FROM tasks ORDER BY updated DESC').all().map(row => JSON.parse((row as { payload: string }).payload) as Task); }
  save(task: Task) { this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated=excluded.updated').run(task.id, JSON.stringify(task), task.updatedAt); }
  close() { this.db.close(); }
}
