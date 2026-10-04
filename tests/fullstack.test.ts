import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Runner } from '../server/runner.js';
import { ProjectRuntime } from '../server/runtime.js';
import { coverageChecks } from '../server/browser-qa.js';
import { routeStage } from '../server/policy.js';
import { claudeArgs, type AskEngine } from '../server/engine.js';
import type { ApiContract, BrowserCase, StageOutput, Task } from '../shared/types.js';

const note = {type:'object', required:['id','title'], additionalProperties:false, properties:{id:{type:'string'},title:{type:'string'}}};
const error = {type:'object', required:['error'], properties:{error:{type:'object', required:['code','message'], properties:{code:{type:'string'},message:{type:'string'}}}}};
const contract: ApiContract = {version:'1', endpoints:[
  {method:'GET',path:'/api/notes',requestSchema:{type:'object'},responses:[{status:200,schema:{type:'object',required:['data'],additionalProperties:false,properties:{data:{type:'array',items:note}}}}]},
  {method:'POST',path:'/api/notes',requestSchema:{type:'object',required:['title'],additionalProperties:false,properties:{title:{type:'string',minLength:1}}},responses:[{status:201,schema:{type:'object',required:['data'],properties:{data:note}}},{status:400,schema:error}]},
  {method:'DELETE',path:'/api/notes/:id',requestSchema:{type:'object'},responses:[{status:200,schema:{type:'object',required:['data'],properties:{data:{type:'object',required:['deleted'],properties:{deleted:{type:'boolean'}}}}}}]},
]};
const backend = `export async function handle({method,path,body,store}) {
 const state=await store.read(); const notes=state.notes||[];
 if(method==='GET'&&path==='/api/notes')return {status:200,body:{data:notes}};
 if(method==='POST'&&path==='/api/notes'){const note={id:String(Date.now()),title:body.title.trim()};await store.write({notes:[...notes,note]});return {status:201,body:{data:note}};}
 if(method==='DELETE'&&path.startsWith('/api/notes/')){await store.write({notes:notes.filter(n=>n.id!==path.split('/').pop())});return {status:200,body:{data:{deleted:true}}};}
 return null;
}`;
const html = `<!doctype html><html lang="id"><head><title>Notes</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}main{max-width:700px;margin:auto}button,input{font:inherit}#message{min-height:20px}</style></head><body><main><h1>Notes</h1><form id="form"><label>Title<input id="title" required></label><button id="save">Save</button></form><p id="message" role="status"></p><ul id="notes"></ul></main><script type="module" src="frontend/app.js"></script></body></html>`;
const frontend = `const $=id=>document.getElementById(id);
 async function api(url,options){const r=await fetch(url,options);const payload=await r.json();if(!r.ok)throw new Error(payload.error?.message||'Error');return payload.data;}
 async function render(){try{const notes=await api('/api/notes');$('notes').replaceChildren();for(const n of notes){const li=document.createElement('li'),span=document.createElement('span'),button=document.createElement('button');span.textContent=n.title;button.textContent='Delete';button.onclick=async()=>{await api('/api/notes/'+n.id,{method:'DELETE'});await render();};li.append(span,button);$('notes').append(li);}}catch(e){$('message').textContent=e.message;}}
 $('form').onsubmit=async e=>{e.preventDefault();const title=$('title').value.trim();if(!title){$('message').textContent='Title required';return;}$('save').disabled=true;try{await api('/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});$('form').reset();$('message').textContent='Saved';await render();}catch(e){$('message').textContent='Failed';}finally{$('save').disabled=false;}};
 render();`;
const cases: BrowserCase[] = [
 {id:'crud',criterionId:'crud',title:'Create and delete through live API',steps:[{action:'fill',selector:'#title',value:'Browser note'},{action:'click',selector:'#save'},{action:'expectText',selector:'#notes',value:'Browser note'},{action:'click',selector:'#notes button'},{action:'expectCount',selector:'#notes li',count:0}]},
 {id:'empty',criterionId:'empty',title:'Reject whitespace and invalid API payload',steps:[{action:'fill',selector:'#title',value:'   '},{action:'click',selector:'#save'},{action:'expectText',selector:'#message',value:'Title required'},{action:'expectCount',selector:'#notes li',count:0},{action:'api',value:'/api/notes',method:'POST',body:'{}',status:400}]},
 {id:'persist',criterionId:'persist',title:'Data survives refresh',steps:[{action:'fill',selector:'#title',value:'Persistent note'},{action:'click',selector:'#save'},{action:'expectText',selector:'#notes',value:'Persistent note'},{action:'reload'},{action:'expectText',selector:'#notes',value:'Persistent note'}]},
 {id:'offline',criterionId:'offline',title:'Offline error and recovery',steps:[{action:'offline',value:'true'},{action:'fill',selector:'#title',value:'Retry note'},{action:'click',selector:'#save'},{action:'expectText',selector:'#message',value:'Failed'},{action:'offline',value:'false'},{action:'click',selector:'#save'},{action:'expectText',selector:'#notes',value:'Retry note'}]},
];
function engineWithBug(): AskEngine {
 let backendCalls = 0;
 return async ({role,phase,task}) => {
  const output: StageOutput = {summary:`${role} ready`,markdown:`${role} follows existing conventions`,files:[],verdict:'none',issues:[],questions:[]};
  if(role==='ceo')output.plan={needsBackend:true,needsDesign:true,complexity:'clear',reason:'Small CRUD feature'};
  if(role==='pm'){output.contract=contract;output.criteria=[{id:'crud',description:'CRUD works',category:'happy'},{id:'empty',description:'Empty input is rejected',category:'edge'},{id:'persist',description:'Server data survives refresh',category:'persistence'},{id:'offline',description:'Offline failure recovers',category:'error'}];}
  if(role==='backend'){backendCalls++;output.files=[{path:'backend/app.mjs',content:backendCalls===1?backend.replace('body:{data:notes}','body:{items:notes}'):backend}];}
  if(role==='frontend')output.files=[{path:'index.html',content:html},{path:'frontend/app.js',content:frontend}];
  if(role==='qa'&&phase==='test-plan')output.browserTests=cases;
  if(role==='qa'&&phase==='review'){
   if(task.checks.every(check=>check.passed)){output.verdict='pass';}
   else{output.verdict='revise';output.issues=['GET response violates contract'];output.findings=[{role:'backend',summary:'GET returns items instead of data',reproduction:'Open app or GET /api/notes',expected:'{data:[]}',actual:'{items:[]}'}];}
  }
  return {output,inputTokens:1,outputTokens:1};
 };
}

test('real browser catches API mismatch, backend repairs, full regression passes, and QA data stays separate', {timeout:60000}, async () => {
 const root=await mkdtemp(path.join(os.tmpdir(),'agent-town-browser-')), store=new Store(path.join(root,'office.sqlite'));
 const engine=engineWithBug(), runner=new Runner(store,path.join(root,'projects'),()=>{},engine,engine);
 runner.health={installed:true,loggedIn:true,provider:'fixture'};
 let runtime: ProjectRuntime | undefined;
 try {
  const task=await runner.create('Build server-backed notes','claude');
  const deadline=Date.now()+55000;
  while(!['done','needs_attention'].includes(task.status)){if(Date.now()>deadline)throw new Error(`Timeout ${task.status}`);await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(task.status,'done',`${task.error}\n${JSON.stringify(task.checks,null,2)}`);
  assert.equal(task.retry,1);
  assert.equal(task.browserEvidence?.length,4);
  assert.ok(task.checks.every(check=>check.passed));
  assert.equal(task.usage?.filter(item=>item.role==='backend').length,2);
  assert.equal(task.usage?.filter(item=>item.role==='frontend').length,1);
  assert.ok(task.files.some(file=>file.path.endsWith('.png')));
  const evidence=JSON.parse(await readFile(path.join(task.workspace,'qa/run-1/evidence.json'),'utf8'));
  assert.equal(evidence[0].steps[2].action,'expectText');
  runtime=await new ProjectRuntime(task,false).start();
  assert.deepEqual((await (await fetch(runtime.url+'/api/notes')).json()).data,[]);
  const denied=await fetch(runtime.url+'/api/notes',{method:'POST',headers:{Origin:'http://evil.test','Content-Type':'application/json'},body:'{"title":"bad"}'});
  assert.equal(denied.status,403);
  const response=await fetch(runtime.url+'/api/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"title":"Production note"}'});
  assert.equal(response.status,201);
  await runtime.stop(); runtime=await new ProjectRuntime(task,false).start();
  assert.equal((await (await fetch(runtime.url+'/api/notes')).json()).data[0].title,'Production note');
  assert.equal((await fetch(runtime.url+'/backend/app.mjs')).status,404);
 } finally {await runner.shutdown();await runtime?.stop();store.close();await rm(root,{recursive:true,force:true});}
});

test('routing is based on task complexity and recurring failures; CLI pins model and effort', () => {
 const task={plan:{needsBackend:true,needsDesign:true,complexity:'clear',reason:'clear'},retry:0} as Task;
 assert.equal(routeStage(task,'ceo').model,'claude-sonnet-5-5');
 task.plan!.complexity='complex';assert.equal(routeStage(task,'backend').model,'claude-opus-5-5');
 task.plan!.complexity='clear';assert.equal(routeStage(task,'frontend',2).effort,'medium');assert.equal(routeStage(task,'frontend',2).model,'claude-opus-5-5');
 const routing=routeStage(task,'frontend',2), args=claudeArgs({task,role:'frontend',context:'',routing,signal:new AbortController().signal,onOutput:()=>{}});
 assert.equal(args[args.indexOf('--model')+1],routing.model);assert.equal(args[args.indexOf('--effort')+1],routing.effort);
});

test('coverage fails when a criterion has no real assertion', () => {
 const task={criteria:[{id:'a',description:'must work',category:'happy'}]} as Task;
 assert.equal(coverageChecks(task,[{id:'a',criterionId:'a',title:'fake',steps:[{action:'goto',value:'/'}]}])[0].passed,false);
});

test('QA fault injection, rapid clicks, request counts, seeded data and exact assertions run in a real browser', {timeout:30000}, async () => {
 const {saveFiles}=await import('../server/files.js');
 const {openBrowserQA}=await import('../server/browser-qa.js');
 const root=await mkdtemp(path.join(os.tmpdir(),'agent-town-faults-'));
 let session: Awaited<ReturnType<typeof openBrowserQA>>|undefined;
 try {
  const files=[...await saveFiles(root,[{path:'index.html',content:html},{path:'frontend/app.js',content:frontend}],'frontend'),...await saveFiles(root,[{path:'backend/app.mjs',content:backend}],'backend')];
  const task={workspace:root,files,plan:{needsBackend:true,needsDesign:true,complexity:'clear',reason:'test'},contract,criteria:[{id:'faults',description:'Deep checks',category:'edge'}],retry:0} as Task;
  session=await openBrowserQA(task,new AbortController().signal,()=>{});
  const report=await session.run([{id:'faults',criterionId:'faults',title:'Fault injection and state',steps:[
   {action:'seedData',value:'{"notes":[{"id":"seed","title":"Seeded"}]}'},{action:'reload'},{action:'expectExactText',selector:'#notes span',value:'Seeded'},
   {action:'delayResponse',value:'/api/notes',method:'POST',delayMs:2000},{action:'fill',selector:'#title',value:'Slow'},{action:'rapidClick',selector:'#save',count:3},{action:'expectDisabled',selector:'#save'},
   {action:'expectExactText',selector:'#message',value:'Saved'},{action:'expectCount',selector:'#notes li',count:2},{action:'expectRequestCount',value:'/api/notes',method:'POST',count:1},{action:'expectEnabled',selector:'#save'},
   {action:'mockResponse',value:'/api/notes',method:'POST',status:500,body:'{"error":{"code":"TEST_FAILURE","message":"Injected failure"}}'},
   {action:'fill',selector:'#title',value:'Failure'},{action:'click',selector:'#save'},{action:'expectExactText',selector:'#message',value:'Failed'},
   {action:'api',value:'/api/notes',method:'POST',body:'{}',status:400,responseBody:'{"error":{"code":"VALIDATION_ERROR","message":"Request tidak sesuai kontrak."}}'},
   {action:'click',selector:'#notes li:first-child button'},{action:'expectCount',selector:'#notes li',count:1},
   {action:'viewport',width:320,height:568},{action:'expectNoOverflow'},{action:'expectMinSize',selector:'#save',height:20},
   {action:'reducedMotion',value:'true'},{action:'expectStyle',selector:'#save',property:'animation-duration',value:'0s'},
  ]}]);
  assert.ok(report.checks.every(check=>check.passed),JSON.stringify(report.checks.filter(check=>!check.passed)));
 } finally {await session?.close();await rm(root,{recursive:true,force:true});}
});

test('mandatory mobile and reduced-motion checks catch browser-only exceptions', { timeout: 15000 }, async () => {
  const { saveFiles } = await import('../server/files.js');
  const { openBrowserQA } = await import('../server/browser-qa.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-mobile-errors-'));
  let session: Awaited<ReturnType<typeof openBrowserQA>> | undefined;
  try {
    const content = '<!doctype html><html><head><title>Greeting</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="hi">Hi</button><script>if(matchMedia("(prefers-reduced-motion: reduce)").matches)throw new Error("Reduced-motion initialization failed");</script></body></html>';
    const files = await saveFiles(root, [{ path: 'index.html', content }], 'frontend');
    const task = { workspace: root, files, plan: { needsBackend: false, needsDesign: true, complexity: 'clear', reason: 'test' }, criteria: [{ id: 'hi', description: 'Greeting renders', category: 'happy' }], retry: 0 } as Task;
    session = await openBrowserQA(task, new AbortController().signal, () => {});
    const report = await session.run([{ id: 'hi', criterionId: 'hi', title: 'Desktop greeting', steps: [{ action: 'expectVisible', selector: '#hi' }] }]);
    assert.equal(report.evidence[0].passed, true, 'The desktop control still renders.');
    const runtime = report.checks.find(check => check.name === 'Runtime JavaScript');
    assert.equal(runtime?.passed, false, 'Reduced-motion exceptions must prevent readiness.');
    assert.match(runtime!.detail, /Reduced-motion initialization failed/);
  } finally { await session?.close(); await rm(root, { recursive: true, force: true }); }
});

test('browser storage survives closing and reopening a project preview', { timeout: 15000 }, async () => {
  const { saveFiles } = await import('../server/files.js');
  const { PreviewManager } = await import('../server/runtime.js');
  const { chromium } = await import('playwright');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-preview-storage-'));
  let manager = new PreviewManager();
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const content = '<!doctype html><html><head><title>Preview storage</title></head><body><output id="count"></output><button id="add">Add</button><script>const show=()=>document.getElementById("count").textContent=localStorage.getItem("preview-count")||"0";document.getElementById("add").onclick=()=>{localStorage.setItem("preview-count",String(Number(localStorage.getItem("preview-count")||0)+1));show()};show();</script></body></html>';
    const files = await saveFiles(root, [{ path: 'index.html', content }], 'frontend');
    let task = { id: 'preview-storage', workspace: root, files, plan: { needsBackend: false, needsDesign: false, complexity: 'clear', reason: 'test' } } as Task;
    const firstURL = await manager.open(task);
    browser = await chromium.launch({ headless: true, executablePath: process.env.AGENT_TOWN_BROWSER || undefined });
    const page = await browser.newPage();
    await page.goto(firstURL, { waitUntil: 'networkidle' });
    await page.click('#add');
    assert.equal(await page.textContent('#count'), '1');
    await manager.shutdown();
    task = JSON.parse(JSON.stringify(task)) as Task;
    manager = new PreviewManager();
    const reopenedURL = await manager.open(task);
    await page.goto(reopenedURL, { waitUntil: 'networkidle' });
    assert.equal(await page.textContent('#count'), '1', 'Reopening must preserve browser storage.');
    assert.equal(reopenedURL, firstURL);
  } finally { await browser?.close(); await manager.shutdown(); await rm(root, { recursive: true, force: true }); }
});

test('an occupied preview port falls back locally without serving the other process', async () => {
  const { createServer } = await import('node:http');
  const { saveFiles } = await import('../server/files.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-port-'));
  const occupied = createServer((_req, res) => res.end('Other process'));
  let runtime: ProjectRuntime | undefined;
  try {
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    assert.ok(address && typeof address !== 'string');
    const files = await saveFiles(root, [{ path: 'index.html', content: '<html><body>Our project</body></html>' }], 'frontend');
    const task = { workspace: root, files, previewPort: address.port, plan: { needsBackend: false } } as Task;
    runtime = await new ProjectRuntime(task, false).start();
    assert.notEqual(task.previewPort, address.port);
    assert.match(await (await fetch(runtime.url)).text(), /Our project/);
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), 'Other process');
  } finally { await runtime?.stop(); await new Promise<void>(resolve => occupied.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

test('backend JSON requests preserve UTF-8 characters split across network chunks', async () => {
  const { request } = await import('node:http');
  const { saveFiles } = await import('../server/files.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-json-utf8-'));
  let runtime: ProjectRuntime | undefined;
  try {
    const files = [...await saveFiles(root, [{ path: 'index.html', content: html }], 'frontend'), ...await saveFiles(root, [{ path: 'backend/app.mjs', content: backend }], 'backend')];
    const task = { workspace: root, files, contract, plan: { needsBackend: true } } as Task;
    runtime = await new ProjectRuntime(task, false).start();
    const payload = Buffer.from(JSON.stringify({ title: '🌿 Catatan' }));
    const split = payload.indexOf(Buffer.from('🌿')) + 1;
    const response = await new Promise<{ status: number; body: { data: { title: string } } }>((resolve, reject) => {
      const req = request(runtime!.url + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.write(payload.subarray(0, split));
      setTimeout(() => req.end(payload.subarray(split)), 20);
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.data.title, '🌿 Catatan');
  } finally { await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
});

test('invalid requests leave data unchanged and parallel backend writes survive restart', async () => {
  const { saveFiles } = await import('../server/files.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-town-parallel-data-'));
  let runtime: ProjectRuntime | undefined;
  try {
    const files = [...await saveFiles(root, [{ path: 'index.html', content: html }], 'frontend'), ...await saveFiles(root, [{ path: 'backend/app.mjs', content: backend }], 'backend')];
    const task = { workspace: root, files, contract, plan: { needsBackend: true } } as Task;
    runtime = await new ProjectRuntime(task, false).start();
    const post = (body: string) => fetch(runtime!.url + '/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const invalid = await Promise.all(['{', '{"title":42}', '{"title":"Bad","extra":true}', JSON.stringify({ title: '🌿'.repeat(17000) })].map(post));
    assert.deepEqual(invalid.map(response => response.status), [400, 400, 400, 413]);
    assert.deepEqual((await (await fetch(runtime.url + '/api/notes')).json()).data, []);
    const titles = Array.from({ length: 20 }, (_, index) => `Parallel note ${index}`);
    const responses = await Promise.all(titles.map(title => post(JSON.stringify({ title }))));
    assert.ok(responses.every(response => response.status === 201));
    const readTitles = async () => (await (await fetch(runtime!.url + '/api/notes')).json()).data.map((note: { title: string }) => note.title).sort();
    assert.deepEqual(await readTitles(), [...titles].sort());
    await runtime.stop(); runtime = await new ProjectRuntime(task, false).start();
    assert.deepEqual(await readTitles(), [...titles].sort());
  } finally { await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
});
