import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoleId } from '../shared/types.js';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
// Read on every call so an edited playbook applies to the next agent call without a restart.
export function roleSkill(role: RoleId, folder = process.env.AGENT_TOWN_SKILLS || SKILLS) {
  try { return readFileSync(path.join(folder, `${role}.md`), 'utf8').trim().slice(0, 4000); } catch { return ''; }
}
