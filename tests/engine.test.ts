import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askClaude, claudeArgs, closeLiveSession, closeLiveSessions, localTools, RESUME_CONTEXT_LIMIT, stageLimitMinutes, type EngineRequest } from '../server/engine.js';
import type { Task } from '../shared/types.js';

async function withFakeCLI(source: string, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-cli-'));
  const executable = path.join(root, 'claude');
  const originalPath = process.env.PATH;
  try {
    await writeFile(executable, `#!${process.execPath}\n${source}`); await chmod(executable, 0o755);
    process.env.PATH = `${root}${path.delimiter}${originalPath || ''}`;
    await run(root);
  } finally { process.env.PATH = originalPath; await rm(root, { recursive: true, force: true }); }
}
function request(root: string, controller = new AbortController()): EngineRequest {
  return { role: 'ceo', task: { workspace: root, prompt: 'Review local fixture' } as Task, context: '', signal: controller.signal, onOutput: () => {}, routing: { model: 'claude-sonnet-5-5', effort: 'medium', reason: 'Fixture protocol test' } };
}
const output = { summary: '🌿 Selesai', markdown: 'Scope jelas.', files: [], verdict: 'none', issues: [], questions: [], plan: { needsBackend: false, needsDesign: false, complexity: 'clear', reason: 'fixture' } };

test('laptop CLI uses native tools in the actual project and reports tool activity', async () => {
  const native = { ...output, plan: { ...output.plan, kind: 'answer' } };
  await withFakeCLI(`const fs=require('node:fs');const path=require('node:path');process.stdin.resume();process.stdin.on('end',()=>{
    const args=process.argv;const flag=name=>args[args.indexOf(name)+1];
    if(path.basename(process.cwd())!=='existing-repo'||!args.includes('--dangerously-skip-permissions')||flag('--tools')!==${JSON.stringify(localTools('ceo'))}||!args.includes('--safe-mode')||!args.includes('--system-prompt')||JSON.parse(flag('--settings')).sandbox.enabled!==false)process.exit(2);
    fs.writeFileSync('../outside-cwd.txt','Native tools can edit beyond the starting folder.');
    for(const event of [{type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command:'pwd'}}]}},{type:'user',message:{content:[{type:'tool_result',content:'sensitive tool body'}]}},{type:'result',structured_output:${JSON.stringify(native)}}])process.stdout.write(JSON.stringify(event)+'\\n');
  });`, async root => {
    const projectPath = path.join(root, 'existing-repo'); await mkdir(projectPath);
    const chunks: string[] = [];
    const result = await askClaude({ ...request(root), task: { ...request(root).task, access: 'local', projectPath }, onOutput: text => chunks.push(text) });
    assert.equal(result.output.plan?.kind, 'answer');
    assert.match(await readFile(path.join(root, 'outside-cwd.txt'), 'utf8'), /beyond/);
    assert.match(chunks.join(''), /\[Bash\] pwd/); assert.match(chunks.join(''), /Tool selesai/);
    assert.doesNotMatch(chunks.join(''), /sensitive tool body/);
    const legacy = claudeArgs(request(root));
    assert.equal(legacy[legacy.indexOf('--tools') + 1], ''); assert.ok(legacy.includes('--safe-mode'));
    const local = { ...request(root), task: { ...request(root).task, access: 'local', projectPath } as Task };
    assert.ok(claudeArgs({ ...local, role: 'qa', phase: 'live' }).includes('--chrome'));
    const browsing = claudeArgs({ ...local, role: 'backend', chrome: true });
    assert.ok(browsing.includes('--chrome')); assert.match(browsing[browsing.indexOf('--system-prompt') + 1], /BROWSER ACCESS/);
    const plain = claudeArgs({ ...local, role: 'backend' });
    const tester = claudeArgs({ ...local, role: 'qa', phase: 'live' });
    assert.equal(tester[tester.indexOf('--tools') + 1], 'Bash,Read,Glob,Grep'); assert.match(tester[tester.indexOf('--disallowedTools') + 1], /gif_creator/);
    assert.ok(!localTools('pm').includes('Edit') && !localTools('ceo').includes('Write') && localTools('frontend').includes('Edit'));
    assert.ok(!plain.includes('--disallowedTools'));
    assert.ok(!plain.includes('--chrome')); assert.match(plain[plain.indexOf('--system-prompt') + 1], /needsBrowser=true/);
    for (const other of [{ ...local, role: 'qa' as const, phase: 'review' as const }, { ...local, role: 'frontend' as const }, { ...request(root), role: 'qa' as const, phase: 'live' as const }]) assert.ok(!claudeArgs(other).includes('--chrome'));
  });
});

test('live QA keeps one CLI process across a question so its browser tab survives, then ends it', async () => {
  await withFakeCLI(`let buffer='',turn=0;process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))!==-1){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
    const text=JSON.parse(line).message.content[0].text;turn++;const ask=!text.includes('Sudah, lanjutkan');
    process.stdout.write(JSON.stringify({type:'result',structured_output:{summary:[process.pid,turn,text.startsWith('CONTINUE YOUR EARLIER SESSION'),process.argv.includes('--chrome')].join(' '),markdown:'ok',files:[],verdict:'none',issues:[],questions:ask?[{id:'login',question:'Login manual',options:['Sudah, lanjutkan']}]:[],findings:[],liveEvidence:[]},usage:{input_tokens:1,output_tokens:1}})+'\\n');}});
    process.stdin.on('end',()=>process.exit(0));`, async root => {
    const live = (id: string, context = ''): EngineRequest => ({ ...request(root), role: 'qa', phase: 'live', context, task: { id, workspace: root, prompt: 'Cek login', access: 'local', projectPath: root } as Task });
    try {
      const first = await askClaude(live('a')), [pid] = first.output.summary.split(' ');
      assert.equal(first.output.questions.length, 1); assert.equal(first.output.summary, `${pid} 1 false true`);
      const second = await askClaude(live('a', 'Sudah, lanjutkan'));
      assert.equal(second.output.summary, `${pid} 2 true true`);
      const third = await askClaude(live('a', 'Sudah, lanjutkan'));
      assert.notEqual(third.output.summary.split(' ')[0], pid); assert.match(third.output.summary, / 1 false true$/);
      const waiting = await askClaude(live('b'));
      closeLiveSession('b');
      const fresh = await askClaude(live('b', 'Sudah, lanjutkan'));
      assert.notEqual(fresh.output.summary.split(' ')[0], waiting.output.summary.split(' ')[0]); assert.match(fresh.output.summary, / 1 false true$/);
    } finally { closeLiveSessions(); }
  });
});

test('a session is kept for later rounds only when resuming is cheap, and planners keep it only while waiting', async () => {
  await withFakeCLI(`let buffer='',turn=0;process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))!==-1){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
    const text=JSON.parse(line).message.content[0].text;turn++;
    process.stdout.write(JSON.stringify({type:'stream_event',event:{type:'message_start',message:{usage:{input_tokens:10,cache_creation_input_tokens:10,cache_read_input_tokens:text.includes('BIG')?${RESUME_CONTEXT_LIMIT}:1000}}}})+'\\n');
    process.stdout.write(JSON.stringify({type:'result',structured_output:{summary:[process.pid,turn,text.startsWith('CONTINUE YOUR EARLIER SESSION')].join(' '),markdown:'ok',files:[],verdict:'none',issues:[],questions:text.includes('ASK')?[{id:'q',question:'Pilih',options:['A']}]:[]},usage:{input_tokens:1,output_tokens:1}})+'\\n');}});
    process.stdin.on('end',()=>process.exit(0));`, async root => {
    const call = (id: string, role: EngineRequest['role'], persist: EngineRequest['persist'], context = ''): EngineRequest => ({ ...request(root), role, persist, context, task: { id, workspace: root, prompt: 'Perbaiki', access: 'local', projectPath: root } as Task });
    const pid = (value: { output: { summary: string } }) => value.output.summary.split(' ')[0];
    try {
      const work = await askClaude(call('small', 'backend', 'work')), repair = await askClaude(call('small', 'backend', 'work'));
      assert.equal(repair.output.summary, `${pid(work)} 2 true`); assert.equal(repair.resumed, true); assert.equal(work.resumed, false);
      const heavy = await askClaude(call('big', 'backend', 'work', 'BIG')), restarted = await askClaude(call('big', 'backend', 'work'));
      assert.notEqual(pid(restarted), pid(heavy)); assert.match(restarted.output.summary, / 1 false$/);
      const plan = await askClaude(call('plan', 'ceo', 'question')), replanned = await askClaude(call('plan', 'ceo', 'question', 'ASK'));
      assert.notEqual(pid(replanned), pid(plan));
      const answered = await askClaude(call('plan', 'ceo', 'question'));
      assert.equal(answered.output.summary, `${pid(replanned)} 2 true`);
      const escalated = await askClaude({ ...call('small', 'backend', 'work'), routing: { model: 'claude-opus-5-5', effort: 'medium', reason: 'Eskalasi' } });
      assert.notEqual(pid(escalated), pid(work));
    } finally { closeLiveSessions(); }
  });
});

test('role skills, the built-in working method experiment and time limits follow the role', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'agent-town-skills-')), original = process.env.AGENT_TOWN_SKILLS;
  try {
    await writeFile(path.join(folder, 'backend.md'), 'Periksa DNS lalu TLS lalu HTTP.'); process.env.AGENT_TOWN_SKILLS = folder;
    const local = (role: EngineRequest['role'], extra: Partial<Task> = {}): EngineRequest => ({ ...request(folder), role, task: { workspace: folder, prompt: 'Uji', access: 'local', projectPath: folder, ...extra } as Task });
    const backend = claudeArgs(local('backend')), frontend = claudeArgs(local('frontend'));
    assert.match(backend[backend.indexOf('--system-prompt') + 1], /ROLE SKILL.*Periksa DNS lalu TLS lalu HTTP\./s);
    assert.doesNotMatch(frontend[frontend.indexOf('--system-prompt') + 1], /ROLE SKILL/);
    const native = claudeArgs(local('backend', { nativeRoles: ['backend'] }));
    assert.ok(native.includes('--append-system-prompt') && !native.includes('--system-prompt'));
    assert.ok(!claudeArgs(local('frontend', { nativeRoles: ['backend'] })).includes('--append-system-prompt'));
    assert.deepEqual([stageLimitMinutes(local('ceo')), stageLimitMinutes(local('backend')), stageLimitMinutes({ ...local('qa'), phase: 'live' }), stageLimitMinutes({ ...request(folder), role: 'backend' })], [6, 12, 20, 6]);
  } finally { if (original === undefined) delete process.env.AGENT_TOWN_SKILLS; else process.env.AGENT_TOWN_SKILLS = original; await rm(folder, { recursive: true, force: true }); }
});

test('laptop CLI rejects a missing working directory before starting a provider call', async () => {
  await assert.rejects(askClaude({ ...request('/tmp'), task: { ...request('/tmp').task, access: 'local' } }), /Folder kerja/);
});

test('CLI streaming preserves split UTF-8 text, structured output and cache usage', async () => {
  const source = `let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
    const message=JSON.parse(input);if(message.message.role!=='user'||!process.argv.includes('--model')||!process.argv.includes('--effort'))process.exit(2);
    const stream=Buffer.from(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:'🌿 Working'}}})+'\\n');
    const result=Buffer.from(JSON.stringify({type:'result',structured_output:${JSON.stringify(output)},usage:{input_tokens:3,output_tokens:4,cache_creation_input_tokens:5,cache_read_input_tokens:6}})+'\\n');
    const split=stream.indexOf(Buffer.from('🌿'))+1;process.stdout.write(stream.subarray(0,split));
    setTimeout(()=>{process.stdout.write(stream.subarray(split));const n=result.indexOf(Buffer.from('🌿'))+2;process.stdout.write(result.subarray(0,n));setTimeout(()=>process.stdout.write(result.subarray(n)),20)},20);
  });`;
  await withFakeCLI(source, async root => {
    const chunks: string[] = [];
    const result = await askClaude({ ...request(root), onOutput: text => chunks.push(text) });
    assert.equal(chunks.join(''), '🌿 Working');
    assert.equal(result.output.summary, '🌿 Selesai');
    assert.equal(result.inputTokens, 8); assert.equal(result.outputTokens, 4);
    assert.equal(result.cacheReadTokens, 6); assert.equal(result.cacheWriteTokens, 5);
  });
});

test('CLI provider failure and malformed structured output are rejected', async () => {
  for (const result of [{ type: 'result', is_error: true, result: 'Session limit fixture' }, { type: 'result', structured_output: { summary: 'incomplete' } }]) {
    await withFakeCLI(`process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify(result) + '\n')}));`, async root => {
      await assert.rejects(askClaude(request(root)), 'is_error' in result ? /Session limit fixture/ : /Format hasil agent/);
    });
  }
});

test('stopping a CLI invocation terminates its process instead of leaving background work', async () => {
  await withFakeCLI(`process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:String(process.pid)}}})+'\\n');setInterval(()=>{},100);});`, async root => {
    const controller = new AbortController();
    let childPid = 0;
    await assert.rejects(askClaude({ ...request(root, controller), onOutput: text => { childPid = Number(text); controller.abort(); } }), /dihentikan/);
    assert.ok(childPid > 0);
    const deadline = Date.now() + 2000;
    let exists = true;
    while (exists && Date.now() < deadline) {
      try { process.kill(childPid, 0); await new Promise(resolve => setTimeout(resolve, 15)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; exists = false; }
    }
    assert.equal(exists, false);
  });
});

test('a nonzero CLI exit cannot turn a valid-looking output into success', async () => {
  await withFakeCLI(`process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'result',structured_output:${JSON.stringify(output)}})+'\\n');process.exitCode=3;});`, async root => {
    await assert.rejects(askClaude(request(root)), /kode 3/);
  });
});

test('stop kills a CLI process that ignores SIGTERM before reporting cancellation', { timeout: 10000 }, async () => {
  let childPid = 0;
  try {
    await withFakeCLI(`process.on('SIGTERM',()=>{});process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'stream_event',event:{delta:{type:'text_delta',text:String(process.pid)}}})+'\\n');setInterval(()=>{},100);});`, async root => {
      const controller = new AbortController();
      await assert.rejects(askClaude({ ...request(root, controller), onOutput: text => { childPid = Number(text); controller.abort(); } }), /dihentikan/);
      assert.ok(childPid > 0);
      assert.throws(() => process.kill(childPid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
    });
  } finally { if (childPid) { try { process.kill(-childPid, 'SIGKILL'); } catch {} } }
});
