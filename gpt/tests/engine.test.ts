import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { askGPT, closeLiveSessions, codexOutputSchema, normalizeOutput, systemPrompt, usesChrome, stageLimitMinutes } from '../server/engine.js';
import type { EngineRequest } from '../server/engine.js';
import type { Task } from '../shared/types.js';
import { schemaFor } from '../server/schema.js';

async function fakeCLI(code: string, run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-gpt-engine-'));
  const old = process.env.AGENT_TOWN_CODEX_EXECUTABLE;
  const file = path.join(root, 'codex'); await writeFile(file, `#!/usr/bin/env node\nprocess.chdir(${JSON.stringify(root)});\n${code}`, { mode: 0o755 });
  process.env.AGENT_TOWN_CODEX_EXECUTABLE = file;
  try { await run(root); } finally { closeLiveSessions(); old === undefined ? delete process.env.AGENT_TOWN_CODEX_EXECUTABLE : process.env.AGENT_TOWN_CODEX_EXECUTABLE = old; await rm(root, { recursive: true, force: true }); }
}
function request(root: string, extra: Partial<EngineRequest> = {}): EngineRequest {
  return { role: 'frontend', task: { id: 'fake-gpt', mode: 'gpt', access: 'local', projectPath: root, workspace: root, prompt: 'Uji engine GPT' } as Task, routing: { model: 'gpt-6.1-sol', effort: 'medium', reason: 'Test' }, context: '', signal: new AbortController().signal, onOutput: () => {}, persist: 'work', ...extra };
}
const server = `const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});let count=0;
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
rl.on('line',l=>{const q=JSON.parse(l);if(q.method==='initialize')return send({id:q.id,result:{}});if(q.method==='account/read')return send({id:q.id,result:{account:{type:'chatgpt'}}});if(q.method==='thread/start'){fs.writeFileSync('params.json',JSON.stringify(q.params));return send({id:q.id,result:{thread:{id:'thr-test'}}})}if(q.method!=='turn/start')return;
count++;fs.writeFileSync('inputs-'+count+'.json',JSON.stringify(q.params.input));send({id:q.id,result:{turn:{id:'turn-'+count,status:'inProgress'}}});
const text=q.params.input[0].text,retry=text.includes('BROWSER NOTE');const ask=text.includes('QUESTION')&&!retry;if(text.includes('BLOCKED')&&!retry)send({method:'item/completed',params:{threadId:'thr-test',item:{type:'mcpToolCall',server:'cua_repl',tool:'js',arguments:{},result:{content:[{type:'text',text:'Google Chrome is blocking automation because another extension UI is open on this page.'}]}}}});const output={summary:process.pid+' '+count,markdown:'Output asli',files:[],verdict:'none',issues:[],questions:ask?[{id:'q',question:'Pilih tujuan',options:['A']}]:[],changedFiles:[]};
send({method:'item/started',params:{threadId:'thr-test',item:{type:'commandExecution',command:'cat README.md'}}});
send({method:'thread/tokenUsage/updated',params:{threadId:'thr-test',tokenUsage:{total:{inputTokens:count*100,cachedInputTokens:count*30,cacheWriteInputTokens:count*5,outputTokens:count*10},last:{inputTokens:q.params.input[0].text.includes('BIG')?70000:1500}}}});
send({method:'item/completed',params:{threadId:'thr-test',item:{type:'agentMessage',text:JSON.stringify(output)}}});
send({method:'turn/completed',params:{threadId:'thr-test',turn:{id:'turn-'+count,status:q.params.input[0].text.includes('FAIL')?'failed':'completed',error:{message:'provider failure'},items:[]}}});});`;

test('GPT adapter uses private native sessions, preserves questions and excludes cached reads from budget', async () => {
  await fakeCLI(server, async root => {
    const activity: string[] = []; const base = request(root, { onOutput: s => activity.push(s), images: ['AA=='] });
    const first = await askGPT(base), second = await askGPT(base);
    assert.equal(first.inputTokens, 70); assert.equal(first.cacheReadTokens, 30); assert.equal(first.cacheWriteTokens, 5); assert.equal(first.outputTokens, 10);
    assert.equal(second.inputTokens, 70); assert.equal(second.resumed, true); assert.equal(second.output.summary.split(' ')[0], first.output.summary.split(' ')[0]);
    assert.ok(activity.some(s => s.includes('[Bash] cat README.md')));
    assert.equal(JSON.parse(await readFile(path.join(root, 'inputs-1.json'), 'utf8')).filter((item: any) => item.type === 'image').length, 1);
    assert.equal(JSON.parse(await readFile(path.join(root, 'inputs-2.json'), 'utf8')).filter((item: any) => item.type === 'image').length, 0);
    const params = JSON.parse(await readFile(path.join(root, 'params.json'), 'utf8'));
    assert.equal(params.sandbox, 'danger-full-access'); assert.equal(params.approvalPolicy, 'never'); assert.equal(params.cwd, root); assert.equal(params.ephemeral, true);
    const questioned = await askGPT(request(root, { role: 'ceo', persist: 'question', context: 'QUESTION' }));
    assert.equal(questioned.output.questions.length, 1);
    const answer = await askGPT(request(root, { role: 'ceo', persist: 'question' }));
    assert.equal(answer.resumed, true); assert.equal(answer.output.summary.split(' ')[0], questioned.output.summary.split(' ')[0]);
  });
});
test('GPT adapter creates a fresh session for a model change or expensive context and rejects failed turns', async () => {
  await fakeCLI(server, async root => {
    const big = await askGPT(request(root, { context: 'BIG' })), next = await askGPT(request(root));
    assert.notEqual(big.output.summary.split(' ')[0], next.output.summary.split(' ')[0]);
    const changed = await askGPT(request(root, { routing: { model: 'gpt-6-astra', effort: 'medium', reason: 'Complex' } }));
    assert.notEqual(next.output.summary.split(' ')[0], changed.output.summary.split(' ')[0]);
    await assert.rejects(askGPT(request(root, { context: 'FAIL' })), /provider failure/);
  });
});
test('GPT stop kills an uncooperative provider before cancellation completes', { timeout: 10000 }, async () => {
  await fakeCLI(`process.on('SIGTERM',()=>{});require('readline').createInterface({input:process.stdin}).on('line',l=>{const q=JSON.parse(l);if(q.method==='initialize')process.stdout.write(JSON.stringify({id:q.id,result:{}})+'\\n');if(q.method==='account/read')process.stdout.write(JSON.stringify({id:q.id,result:{account:{type:'chatgpt'}}})+'\\n');if(q.method==='thread/start')process.stdout.write(JSON.stringify({id:q.id,result:{thread:{id:'a'}}})+'\\n');if(q.method==='turn/start')require('fs').writeFileSync('pid.txt',String(process.pid));});`, async root => {
    const controller = new AbortController(); const pending = askGPT(request(root, { signal: controller.signal }));
    let pid = 0; while (!pid) { try { pid = Number(await readFile(path.join(root, 'pid.txt'), 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    controller.abort(); await assert.rejects(pending, /dihentikan|ditutup/);
    assert.throws(() => process.kill(pid, 0));
  });
});
test('GPT refuses API authentication before creating a generation thread', async () => {
  await fakeCLI(server.replace("type:'chatgpt'", "type:'apiKey'"), async root => {
    await assert.rejects(askGPT(request(root)), /login langganan ChatGPT/);
    await assert.rejects(readFile(path.join(root, 'params.json')), { code: 'ENOENT' });
  });
});
test('runaway whitespace output stops its provider without silently retrying', { timeout: 10000 }, async () => {
  const whitespaceServer = server.replace("count++;", "fs.writeFileSync('pid.txt',String(process.pid));fs.appendFileSync('turns.log','1\\n');send({id:q.id,result:{turn:{id:'runaway',status:'inProgress'}}});send({method:'item/agentMessage/delta',params:{threadId:'thr-test',delta:' '.repeat(8193)}});return;count++;");
  await fakeCLI(whitespaceServer, async root => {
    await assert.rejects(askGPT(request(root)), /teks kosong berulang/);
    const pid = Number(await readFile(path.join(root, 'pid.txt'), 'utf8'));
    assert.throws(() => process.kill(pid, 0));
    assert.equal(await readFile(path.join(root, 'turns.log'), 'utf8'), '1\n');
  });
});
test('a denied Chrome action stops immediately without regenerating and resumes only on a later call', async () => {
  const blockedServer = server
    .replace("fs.writeFileSync('params.json'", "fs.appendFileSync('threads.log',process.pid+'\\n');fs.writeFileSync('params.json'")
    .replace("send({method:'thread/tokenUsage/updated'", "if(q.params.input[0].text.includes('BROWSERBLOCK'))send({method:'item/completed',params:{threadId:'thr-test',item:{type:'mcpToolCall',server:'cua_repl',tool:'js',arguments:{code:'await tab.reload()'},result:{content:[{type:'text',text:'blocking automation because another extension UI is open'}]}}}});send({method:'thread/tokenUsage/updated'");
  await fakeCLI(blockedServer, async root => {
    await assert.rejects(askGPT(request(root, { role: 'qa', phase: 'live', context: 'QUESTION BROWSERBLOCK', persist: 'question' })), /Chrome menolak kontrol/);
    assert.equal((await readFile(path.join(root, 'threads.log'), 'utf8')).trim().split('\n').length, 1);
    const second = await askGPT(request(root, { role: 'qa', phase: 'live', context: 'User restored Chrome', persist: 'question' }));
    assert.equal(second.output.questions.length, 0);
    assert.equal(second.resumed, false);
    const processes = (await readFile(path.join(root, 'threads.log'), 'utf8')).trim().split('\n');
    assert.equal(processes.length, 2);
    assert.notEqual(processes[0], processes[1]);
  });
});
test('GPT output schema and browser access preserve the office contracts and role boundaries', () => {
  const strict = codexOutputSchema(schemaFor('ceo', 'work', false, undefined, true));
  assert.deepEqual(strict.required, Object.keys(strict.properties)); assert.equal(strict.additionalProperties, false);
  assert.equal(strict.properties.criteria.anyOf[1].type, 'null');
  assert.deepEqual(normalizeOutput({ contract: { requestSchema: '{"type":"object"}', schema: '{"type":"string"}' }, plan: null }), { contract: { requestSchema: { type: 'object' }, schema: { type: 'string' } } });
  const root = '/tmp';
  assert.equal(usesChrome(request(root, { role: 'qa', phase: 'live' })), true); assert.equal(usesChrome(request(root)), false);
  assert.deepEqual([stageLimitMinutes(request(root, { role: 'ceo' })), stageLimitMinutes(request(root)), stageLimitMinutes(request(root, { role: 'qa', phase: 'live' }))], [6,12,20]);
  assert.match(systemPrompt(request(root, { role: 'qa', phase: 'live' })), /mcp__cua_repl/); assert.doesNotMatch(systemPrompt(request(root, { role: 'qa', phase: 'live' })), /claude-in-chrome/);
});
