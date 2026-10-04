import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOfficeGateway } from '../gpt/server/gateway.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claudePort = Number(process.env.AGENT_TOWN_CLAUDE_PORT || 4317), gptPort = Number(process.env.AGENT_TOWN_GPT_PORT || 4318);
const children = [
  spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(claudePort) } }),
  spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'gpt/server/index.ts'], { cwd: root, stdio: 'inherit', env: { ...process.env, AGENT_TOWN_GPT_PORT: String(gptPort) } }),
];
const server = createOfficeGateway(path.join(root, 'dist'), `http://127.0.0.1:${claudePort}`, `http://127.0.0.1:${gptPort}`);
server.listen(Number(process.env.PORT || 4319), '127.0.0.1', () => console.log(`Agent Town: http://127.0.0.1:${process.env.PORT || 4319}`));
let stopping = false;
function stop() { if (stopping) return; stopping = true; server.close(); for (const child of children) child.kill('SIGTERM'); }
server.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
for (const child of children) {
  child.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
  child.on('exit', () => { if (!stopping) { process.exitCode = 1; stop(); } });
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
