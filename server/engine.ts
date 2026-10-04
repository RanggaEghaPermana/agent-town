import { spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { ENGINEER_ROLES, type EngineerRole, type EngineHealth, type Phase, type RoleId, type RoutingDecision, type StageOutput, type Task } from '../shared/types.js';
import { roleSkill } from './skills.js';
import { schemaFor, validateOutput } from './schema.js';
import { LOCAL_CONVENTIONS, localRolePrompt, ROLE_PROMPTS, TEAM_RULES } from './policy.js';
import { DEMO_HTML } from './demo-notes.js';

const exec = promisify(execFile);
export async function engineHealth(): Promise<EngineHealth> {
  try {
    const [{stdout: version}, {stdout: auth}] = await Promise.all([
      exec('claude', ['--version'], {timeout: 10000}), exec('claude', ['auth', 'status'], {timeout: 10000}),
    ]);
    const status = JSON.parse(auth);
    return {installed: true, loggedIn: !!status.loggedIn, provider: status.authMethod === 'claude.ai' ? 'Claude subscription' : 'Claude API', version: version.trim()};
  } catch (error) {
    return {installed: (error as NodeJS.ErrnoException).code !== 'ENOENT', loggedIn: false, provider: 'Claude Code', error: 'Claude belum siap. Jalankan claude auth login di terminal.'};
  }
}
export interface EngineRequest {
  role: RoleId; task: Task; context: string; signal: AbortSignal; onOutput: (text: string) => void;
  routing: RoutingDecision; phase?: Phase; images?: (string | { data: string; mediaType: string })[]; chrome?: boolean;
  // 'question' keeps the CLI session only while it waits for the user; 'work' also keeps it for later repair rounds when resuming is cheap.
  persist?: 'question' | 'work';
}
export interface EngineResult {output: StageOutput; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; resumed?: boolean;}
export type AskEngine = (request: EngineRequest) => Promise<EngineResult>;
// Tool definitions are re-read on every step of a call, so each role carries only what its work needs.
// This also makes the read-only roles read-only in fact, not just by instruction.
const READ_TOOLS = 'Bash,Read,Glob,Grep';
export const localTools = (role: RoleId) => role === 'ceo' ? `${READ_TOOLS},WebFetch,WebSearch` : role === 'pm' || role === 'qa' ? READ_TOOLS : role === 'designer' ? 'Bash,Read,Write,Edit,Glob,Grep' : 'Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch';
// Browser tools no office role uses; leaving them out saves about 2,300 tokens per step.
const UNUSED_CHROME_TOOLS = ['gif_creator', 'shortcuts_execute', 'shortcuts_list', 'upload_image', 'file_upload', 'switch_browser', 'select_browser', 'list_connected_browsers'].map(name => `mcp__claude-in-chrome__${name}`).join(',');

// Live QA always drives the user's real Chrome; another role gets it only for work that happens on a website.
export const usesChrome = (request: EngineRequest) => request.task.access === 'local' && (request.role === 'qa' && request.phase === 'live' || !!request.chrome);
// A call that hits its limit loses all its work, so hands-on roles get more room than planners.
export const stageLimitMinutes = (request: EngineRequest) => usesChrome(request) ? 20 : request.task.access === 'local' && ENGINEER_ROLES.includes(request.role as EngineerRole) ? 12 : 6;
export function claudeArgs(request: EngineRequest) {
  const local = request.task.access === 'local';
  // Safe mode skips unrelated customizations, not built-in tools or OS access.
  // Relevant project conventions are read explicitly by the assigned role.
  const access = local ? ['--safe-mode', '--dangerously-skip-permissions', '--tools', localTools(request.role), '--settings', '{"sandbox":{"enabled":false}}'] : ['--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--permission-mode', 'dontAsk'];
  const skill = local ? roleSkill(request.role) : '';
  // Experiment: selected roles keep Claude Code's built-in working method and receive the office rules on top of it.
  const native = local && !!request.task.nativeRoles?.includes(request.role);
  const prompt = `You are a member of a local AI office. Respond in Indonesian. ${TEAM_RULES} ${local ? LOCAL_CONVENTIONS : ''} ROLE: ${local ? localRolePrompt(request.role, request.phase, usesChrome(request)) : ROLE_PROMPTS[request.role]} PHASE: ${request.phase || 'work'}. Return the specified JSON object. markdown contains only useful conclusions and handoffs, never private reasoning. Do not duplicate file contents, criteria, contract schemas or test steps in markdown. Output is the slowest and most expensive part of your call: do not narrate between tool calls, write summary as one sentence, and keep markdown as short as the next role needs (a few sentences for small clear work, never over 250 words) without repeating what the structured fields already say.${skill ? ` ROLE SKILL (the user's playbook for your position; apply it inside your role and the stop rules): ${skill}` : ''}`;
  if (usesChrome(request)) access.push('--chrome', '--disallowedTools', UNUSED_CHROME_TOOLS);
  return ['-p', ...access, '--model', request.routing.model, '--effort', request.routing.effort, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', '--json-schema', JSON.stringify(schemaFor(request.role, request.phase, request.task.plan?.needsBackend, request.task.browserTests, local)), native ? '--append-system-prompt' : '--system-prompt', prompt];
}
function spawnClaude(request: EngineRequest) {
  const env = {...process.env};
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_EFFORT_LEVEL; delete env.ANTHROPIC_MODEL;
  if (request.task.access === 'local') { delete env.CLAUDE_CODE_SAFE_MODE; delete env.CLAUDE_CODE_SIMPLE; }
  const child = spawn('claude', claudeArgs(request), {cwd: request.task.access === 'local' ? request.task.projectPath : request.task.workspace, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}
const killGroup = (child: ChildProcess, signal: NodeJS.Signals) => { try { if (child.pid) process.platform !== 'win32' ? process.kill(-child.pid, signal) : child.kill(signal); } catch {} };
// Forwards visible progress (text, retries, tool activity) without exposing tool results.
function report(request: EngineRequest, event: any) {
  if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') request.onOutput(event.event.delta.text);
  if (event.type === 'system' && event.subtype === 'api_retry') request.onOutput(`\nClaude mencoba ulang (${event.attempt}): ${event.error}.\n`);
  if (request.task.access === 'local' && event.type === 'assistant') for (const block of event.message?.content || []) {
    if (block.type === 'tool_use') {
      const detail = block.input?.command || block.input?.file_path || block.input?.path || block.input?.pattern || block.input?.url || block.input?.action || block.input?.query || '';
      request.onOutput(`\n[${String(block.name).replace('mcp__claude-in-chrome__', 'chrome:')}] ${String(detail).slice(0, 500)}\n`);
    }
  }
  if (request.task.access === 'local' && event.type === 'user') for (const block of event.message?.content || []) {
    if (block.type === 'tool_result') request.onOutput(`\n[Tool ${block.is_error ? 'gagal' : 'selesai'}]\n`);
  }
}
function engineResult(result: Record<string, unknown> | undefined, stderr: string): EngineResult {
  if (!result || result.is_error) throw new Error(String(result?.result || stderr || 'Claude tidak mengirim hasil.'));
  let value = result.structured_output;
  if (!value && typeof result.result === 'string') value = JSON.parse(result.result.replace(/^```json\s*|\s*```$/g, ''));
  const output = validateOutput(value);
  const usage = (result.usage || {}) as Record<string, number>;
  // Cache reads replay the same CLI prompt on every call; they are reported separately and kept out of the budget.
  return {output, inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0), outputTokens: usage.output_tokens || 0, cacheReadTokens: usage.cache_read_input_tokens || 0, cacheWriteTokens: usage.cache_creation_input_tokens || 0};
}
function userMessage(request: EngineRequest, images = request.images || [], lead = '') {
  const text = `${lead}USER BRIEF:\n${request.task.prompt}\n\nPROJECT CONTEXT:\n${request.context}\n\nDeliver your assigned role's output now.`;
  const content: unknown[] = [{type: 'text', text}, ...images.map(image => ({type: 'image', source: typeof image === 'string' ? {type: 'base64', media_type: 'image/png', data: image} : {type: 'base64', media_type: image.mediaType, data: image.data}}))];
  return JSON.stringify({type: 'user', message: {role: 'user', content}}) + '\n';
}
const askOnce: AskEngine = request => new Promise((resolve, reject) => {
  const child = spawnClaude(request);
  let buffer = '', stderr = '', result: Record<string, unknown> | undefined, finished = false;
  let terminationError: Error | undefined, forceKill: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => killGroup(child, signal);
  const end = (error?: Error) => {
    if (finished) return; finished = true; clearTimeout(timer); clearTimeout(forceKill); request.signal.removeEventListener('abort', abort);
    if (error) return reject(error);
    try { resolve(engineResult(result, stderr)); } catch (error) { reject(error); }
  };
  const terminate = (error: Error) => {
    if (finished || terminationError) return;
    terminationError = error; clearTimeout(timer); kill('SIGTERM');
    forceKill = setTimeout(() => kill('SIGKILL'), 1000);
  };
  const abort = () => terminate(new Error('Pekerjaan dihentikan.'));
  const limit = stageLimitMinutes(request);
  const timer = setTimeout(() => terminate(new Error(`Tahap Claude melewati batas waktu ${limit} menit; hasil belum terverifikasi.`)), limit * 60000);
  request.signal.addEventListener('abort', abort, {once: true});
  const consume = (line: string) => {
    if (finished || terminationError) return;
    try {
      const event = JSON.parse(line);
      if (event.type === 'result') result = event;
      report(request, event);
    } catch {}
  };
  child.stdout.on('data', chunk => {
    if (finished || terminationError) return;
    buffer += chunk.toString();
    if (buffer.length > 2000000) {terminate(new Error('Output Claude terlalu besar.')); return;}
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1);}
  });
  child.stderr.on('data', chunk => {stderr = (stderr + chunk.toString()).slice(-4000);});
  child.on('error', end);
  child.on('close', code => {
    if (terminationError) { kill('SIGKILL'); end(terminationError); return; }
    if (buffer.trim()) consume(buffer);
    const failure = code !== 0 ? new Error(`Claude berhenti dengan kode ${code}. ${result?.is_error ? String(result.result || '') : stderr}`.trim()) : undefined;
    end(failure);
  });
  child.stdin.on('error', error => terminate(error));
  child.stdin.end(userMessage(request));
});

// A session is one CLI process kept open across calls. Chrome ties a tab group to its process, so browser
// work continues in the same tab after the user answers; any role that asks a question continues with what
// it already read instead of starting over.
const LIVE_IDLE_MS = 3600000;
// Each step of a resumed session re-reads its whole history, so past this context size a fresh call is cheaper.
// This is a starting policy to calibrate against measured usage.
export const RESUME_CONTEXT_LIMIT = 60000;
type LiveTurn = { request: EngineRequest; resumed: boolean; resolve: (result: EngineResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; abort: () => void };
const sessionSignature = (request: EngineRequest) => [request.routing.model, request.routing.effort, usesChrome(request), !!request.task.nativeRoles?.includes(request.role)].join('|');
class LiveSession {
  private child: ReturnType<typeof spawnClaude>;
  private buffer = ''; private stderr = ''; private sentImages = 0; private closed = false; private context?: number;
  private turn?: LiveTurn; private idle?: ReturnType<typeof setTimeout>;
  readonly signature: string;
  constructor(private key: string, request: EngineRequest) {
    this.signature = sessionSignature(request);
    this.child = spawnClaude(request);
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 2000000) { this.fail(new Error('Output Claude terlalu besar.')); return; }
      let index: number;
      while ((index = this.buffer.indexOf('\n')) !== -1) { const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1); this.consume(line); }
    });
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk.toString()).slice(-4000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('close', code => this.fail(new Error(`Claude berhenti dengan kode ${code}. ${this.stderr}`.trim())));
  }
  ask(request: EngineRequest, resumed: boolean) {
    return new Promise<EngineResult>((resolve, reject) => {
      clearTimeout(this.idle);
      const limit = stageLimitMinutes(request);
      const abort = () => this.fail(new Error('Pekerjaan dihentikan.'));
      const timer = setTimeout(() => this.fail(new Error(`Tahap Claude melewati batas waktu ${limit} menit; hasil belum terverifikasi.`)), limit * 60000);
      request.signal.addEventListener('abort', abort, {once: true});
      this.turn = {request, resumed, resolve, reject, timer, abort};
      const images = (request.images || []).slice(this.sentImages); this.sentImages += images.length;
      const lead = !resumed ? '' : `CONTINUE YOUR EARLIER SESSION ON THIS TASK. You keep everything you already read and did, so do not repeat that exploration; the updated context and your next instruction follow.${usesChrome(request) ? ' For the browser, call tabs_context_mcp with createIfEmpty=true: it returns your existing tab group when it is still open, so keep working in that tab.' : ''}\n\n`;
      this.child.stdin.write(userMessage(request, images, lead));
    });
  }
  private settle() {
    const turn = this.turn; this.turn = undefined;
    if (turn) { clearTimeout(turn.timer); turn.request.signal.removeEventListener('abort', turn.abort); }
    return turn;
  }
  private consume(line: string) {
    if (!this.turn) return;
    let event: any;
    try { event = JSON.parse(line); } catch { return; }
    report(this.turn.request, event);
    if (event.type === 'stream_event' && event.event?.type === 'message_start') {
      const usage = event.event.message?.usage || {};
      this.context = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    }
    if (event.type !== 'result') return;
    const turn = this.settle()!;
    try {
      const result = engineResult(event, this.stderr);
      // A question means the user acts next and the work certainly returns. Finished work stays only when resuming it is cheap.
      const waiting = result.output.questions.length > 0;
      const cheap = turn.request.persist === 'work' && this.context !== undefined && this.context <= RESUME_CONTEXT_LIMIT;
      if (waiting || cheap) { this.idle = setTimeout(() => this.close(), LIVE_IDLE_MS); this.idle.unref(); } else this.close(true);
      turn.resolve({...result, resumed: turn.resumed});
    } catch (error) { this.close(); turn.reject(error as Error); }
  }
  private fail(error: Error) { const turn = this.settle(); this.close(); turn?.reject(error); }
  close(graceful = false) {
    if (this.closed) return; this.closed = true; clearTimeout(this.idle);
    if (liveSessions.get(this.key) === this) liveSessions.delete(this.key);
    this.settle()?.reject(new Error('Pekerjaan dihentikan.'));
    try { this.child.stdin.end(); } catch {}
    if (!graceful) killGroup(this.child, 'SIGTERM');
    setTimeout(() => killGroup(this.child, 'SIGKILL'), graceful ? 5000 : 1000).unref();
  }
}
const liveSessions = new Map<string, LiveSession>();
export function closeLiveSession(taskId: string) { for (const [key, session] of [...liveSessions]) if (key.startsWith(`${taskId}:`)) session.close(); }
export function closeLiveSessions() { for (const session of [...liveSessions.values()]) session.close(); }
const askLive: AskEngine = request => {
  const key = `${request.task.id}:${request.role}:${request.phase || 'work'}`;
  let session = liveSessions.get(key);
  // A different model, effort or toolset is a different process.
  if (session && session.signature !== sessionSignature(request)) { session.close(); session = undefined; }
  const resumed = !!session;
  if (!session) { session = new LiveSession(key, request); liveSessions.set(key, session); }
  return session.ask(request, resumed);
};
export const askClaude: AskEngine = async request => {
  if (request.signal.aborted) throw new Error('Pekerjaan dihentikan.');
  if (request.task.access === 'local' && !request.task.projectPath) throw new Error('Folder kerja project laptop belum dipilih.');
  return usesChrome(request) || request.task.access === 'local' && request.persist ? askLive(request) : askOnce(request);
};

export const askDemo: AskEngine = async ({role, signal, onOutput, phase}) => {
  onOutput('[DEMO] Contoh alur catatan; tanpa memanggil Claude.\n');
  await new Promise<void>((resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(new Error('Demo dihentikan.'));};
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, Number(process.env.DEMO_STAGE_MS || 900));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once: true});
  });
  const output: StageOutput = {summary: `${role} selesai`, markdown: `${role}: mengikuti spek dan konvensi proyek.`, files: [], verdict: 'none', issues: [], questions: []};
  if (role === 'ceo') output.plan = {needsBackend: false, needsDesign: true, complexity: 'clear', reason: 'Catatan lokal dengan scope jelas.'};
  if (role === 'pm') output.criteria = [
    {id: 'notes', description: 'Tambah, cari dan hapus catatan.', category: 'happy'},
    {id: 'empty', description: 'Judul kosong tidak disimpan.', category: 'edge'},
    {id: 'persist', description: 'Catatan bertahan setelah refresh.', category: 'persistence'},
  ];
  if (role === 'frontend') output.files = [{path: 'index.html', content: DEMO_HTML}];
  if (role === 'qa' && phase === 'test-plan') output.browserTests = [
    {id: 'crud', criterionId: 'notes', title: 'Tambah, cari, hapus', steps: [
      {action: 'fill', selector: '#title', value: 'Ide demo'}, {action: 'fill', selector: '#body', value: 'Isi demo'}, {action: 'click', selector: '#form button'}, {action: 'expectText', selector: '#notes', value: 'Ide demo'},
      {action: 'fill', selector: '#search', value: 'Tidak ada'}, {action: 'expectCount', selector: '#notes article', count: 0}, {action: 'fill', selector: '#search', value: ''}, {action: 'click', selector: '#notes article button'}, {action: 'expectCount', selector: '#notes article', count: 0},
    ]},
    {id: 'empty', criterionId: 'empty', title: 'Judul kosong', steps: [{action: 'click', selector: '#form button'}, {action: 'expectCount', selector: '#notes article', count: 0}]},
    {id: 'persist', criterionId: 'persist', title: 'Penyimpanan setelah refresh', steps: [{action: 'fill', selector: '#title', value: 'Tersimpan'}, {action: 'click', selector: '#form button'}, {action: 'reload'}, {action: 'expectText', selector: '#notes', value: 'Tersimpan'}]},
  ];
  if (role === 'qa' && phase === 'review') {output.verdict = 'pass'; output.summary = 'Demo lolos pemeriksaan browser nyata.';}
  return {output, inputTokens: 0, outputTokens: 0};
};
