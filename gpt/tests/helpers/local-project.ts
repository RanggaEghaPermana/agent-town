import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AskEngine } from '../../server/engine.js';
import type { StageOutput } from '../../shared/types.js';

export async function mathProject(root: string) {
  const project = path.join(root, 'existing-repo');
  await mkdir(path.join(project, 'lib'), { recursive: true });
  await writeFile(path.join(project, 'lib/math.mjs'), 'export const double = n => n * 3;\n');
  await writeFile(path.join(project, 'README.md'), 'Existing project conventions stay in place.\n');
  return project;
}

export function localEngine(options: { broken?: boolean; browser?: boolean } = {}) {
  const calls: { role: string; phase: string; project: string }[] = [];
  const engine: AskEngine = async request => {
    const { role, phase, task } = request;
    calls.push({ role, phase: phase || 'work', project: task.projectPath! });
    const output: StageOutput = { summary: `${role} selesai`, markdown: `${role}: project asli diperiksa.`, files: [], verdict: 'none', issues: [], questions: [] };
    const answer = task.prompt.includes('daftar folder');
    if (role === 'ceo') {
      output.plan = { kind: answer ? 'answer' : 'work', needsBackend: false, needsDesign: false, complexity: 'clear', reason: 'Existing fixture project' };
      if (answer) {
        const entries = await readdir(task.projectPath!, { withFileTypes: true });
        output.markdown = `Folder yang benar-benar ada: ${entries.filter(entry => entry.isDirectory()).map(entry => entry.name).join(', ')}.`;
        request.onOutput('[Bash] Membaca direktori fixture melalui filesystem asli.\n');
      }
    }
    if (role === 'pm') output.criteria = [{ id: 'correct', description: options.browser ? 'Counter bertambah satu ketika diklik.' : 'double(4) menghasilkan 8.', category: 'happy' }];
    if (role === 'frontend' && !options.broken) {
      const name = options.browser ? 'site/app.js' : 'lib/math.mjs';
      // Read the actual file before making the requested change; reports stay elsewhere.
      await readFile(path.join(task.projectPath!, name), 'utf8');
      await writeFile(path.join(task.projectPath!, name), options.browser ? 'let n=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(++n);\n' : 'export const double = n => n * 2;\n');
      output.changedFiles = [name];
    }
    if (role === 'qa' && phase === 'prepare') output.localVerification = options.browser
      ? { kind: 'browser', serverCommand: 'node server.mjs', url: 'http://127.0.0.1:{port}/dashboard' }
      : { kind: 'terminal', terminalTests: [{ id: 'double', criterionId: 'correct', title: 'Nilai double', command: 'node --input-type=module -e \'import assert from "node:assert/strict"; import {double} from "./lib/math.mjs"; assert.equal(double(4),8); console.log("double verified")\'' }] };
    if (role === 'qa' && phase === 'test-plan') {
      if (!request.context.includes('count')) throw new Error('QA did not receive the live DOM.');
      output.browserTests = [{ id: 'counter', criterionId: 'correct', title: 'Counter live', steps: [{ action: 'expectExactText', selector: '#count', value: '0' }, { action: 'click', selector: '#add' }, { action: 'expectExactText', selector: '#count', value: '1' }] }];
    }
    if (role === 'qa' && phase === 'review') output.verdict = 'pass';
    return { output, inputTokens: 2, outputTokens: 3 };
  };
  return { engine, calls };
}

export async function browserProject(root: string) {
  const project = path.join(root, 'existing-repo');
  await mkdir(path.join(project, 'site'), { recursive: true });
  await writeFile(path.join(project, 'site/app.js'), 'let n=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(n+=2);\n');
  await writeFile(path.join(project, 'README.md'), 'Keep this existing framework layout.');
  await writeFile(path.join(project, 'server.mjs'), `import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';
const html='<!doctype html><html><head><title>Existing counter</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Counter</h1><output id="count">0</output><button id="add">Tambah</button></main><script src="/app.js"></script></body></html>';
createServer(async(req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL('./site/app.js',import.meta.url)));}else if(req.url==='/dashboard'){res.setHeader('Content-Type','text/html');res.end(html);}else{res.statusCode=404;res.end('Not found');}}).listen(Number(process.env.AGENT_TOWN_PREVIEW_PORT),'127.0.0.1');\n`);
  return project;
}
