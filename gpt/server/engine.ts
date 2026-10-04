import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ENGINEER_ROLES, type EngineerRole, type EngineHealth, type Phase, type RoleId, type RoutingDecision, type StageOutput, type Task } from '../shared/types.js';
import { roleSkill } from './skills.js';
import { schemaFor, validateOutput } from './schema.js';
import { LOCAL_CONVENTIONS, localRolePrompt, ROLE_PROMPTS, TEAM_RULES } from './policy.js';
import { DEMO_HTML } from './demo-notes.js';
import { CodexRpc, type RpcEvent } from './codex-rpc.js';
import { normalizeVerification } from './verification-handoff.js';

export interface EngineRequest {
  role: RoleId; task: Task; context: string; signal: AbortSignal; onOutput: (text: string) => void;
  routing: RoutingDecision; phase?: Phase; images?: (string | { data: string; mediaType: string })[]; chrome?: boolean; persist?: 'question' | 'work';
  // Opt-in diagnostics for disposable integration fixtures; never sent to the office UI.
  onToolDiagnostic?: (item: { server: string; tool: string; arguments: unknown; error?: unknown; content?: unknown[] }) => void;
}
export interface EngineResult { output: StageOutput; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; resumed?: boolean; }
export type AskEngine = (request: EngineRequest) => Promise<EngineResult>;
export const usesChrome = (request: EngineRequest) => request.task.access === 'local' && (request.role === 'qa' && request.phase === 'live' || !!request.chrome);
export const stageLimitMinutes = (request: EngineRequest) => usesChrome(request) ? 20 : request.task.access === 'local' && ENGINEER_ROLES.includes(request.role as EngineerRole) ? 12 : 6;
export const RESUME_CONTEXT_LIMIT = 60000;
const sessions = new Map<string, RoleSession>();
let catalog: NonNullable<EngineHealth['models']> = [];

export async function engineHealth(): Promise<EngineHealth> {
  let rpc: CodexRpc | undefined;
  try {
    const { stdout } = await promisify(execFile)(process.env.AGENT_TOWN_CODEX_EXECUTABLE || 'codex', ['--version'], { timeout: 10000 });
    rpc = new CodexRpc(); await rpc.initialize();
    const account = await rpc.call('account/read', { refreshToken: false });
    const models = await rpc.call('model/list', { limit: 100, includeHidden: false });
    catalog = models.data.map((model: any) => ({ id: model.model, name: model.displayName, efforts: model.supportedReasoningEfforts.map((entry: any) => entry.reasoningEffort), isDefault: model.isDefault }));
    const loggedIn = account.account?.type === 'chatgpt';
    return { installed: true, loggedIn, provider: 'ChatGPT subscription · Codex', version: stdout.trim(), models: catalog, ...(!loggedIn ? { error: 'Login dengan langganan ChatGPT lewat codex login. Kantor ini memakai langganan ChatGPT.' } : {}) };
  } catch (error) { return { installed: (error as NodeJS.ErrnoException).code !== 'ENOENT', loggedIn: false, provider: 'ChatGPT · Codex', error: (error as Error).message }; }
  finally { await rpc?.close(); }
}

// OpenAI structured output requires required keys; optional office fields are represented by null.
// Arbitrary JSON Schema objects (API request/response schemas) travel as JSON strings and are restored before office validation.
export function codexOutputSchema(schema: any): any {
  if (schema.type === 'object') {
    if (!schema.properties) return { type: 'string', description: 'A complete JSON object encoded as a JSON string.' };
    const required = new Set(schema.required || []);
    return { ...schema, additionalProperties: false, properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, required.has(key) ? codexOutputSchema(value) : { anyOf: [codexOutputSchema(value), { type: 'null' }] }])), required: Object.keys(schema.properties) };
  }
  return schema.items ? { ...schema, items: codexOutputSchema(schema.items) } : schema;
}
export function normalizeOutput(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, ['requestSchema', 'schema'].includes(key) && typeof item === 'string' ? JSON.parse(item) : normalizeOutput(item)]));
  return value;
}
export function systemPrompt(request: EngineRequest) {
  const local = request.task.access === 'local';
  const skill = local ? roleSkill(request.role) : '';
  return `You are a member of Agent Town GPT. Respond in Indonesian. ${TEAM_RULES} ${local ? LOCAL_CONVENTIONS : ''} ROLE: ${local ? localRolePrompt(request.role, request.phase, usesChrome(request)) : ROLE_PROMPTS[request.role]} PHASE: ${request.phase || 'work'}. Work ONLY as this role; do not spawn agents or message other Codex chats. Return the specified JSON object. Use questions in your final JSON for user decisions, login or manual steps; do not use a native question tool. markdown contains useful conclusions and handoffs, never private reasoning. Do not duplicate code, criteria or test steps. Keep summary to one sentence and markdown under 250 words. Do not narrate between tool calls.${skill ? ` ROLE SKILL: ${skill}` : ''}`;
}
function signature(request: EngineRequest) { return [request.routing.model, request.routing.effort, usesChrome(request), !!request.task.nativeRoles?.includes(request.role)].join('|'); }

class RoleSession {
  readonly signature: string;
  private rpc: CodexRpc;
  private thread?: string;
  private idle?: ReturnType<typeof setTimeout>;
  private totals = { inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0 };
  private contextSize = 0;
  private sentImages = 0;
  private started = false;
  constructor(private key: string, request: EngineRequest) { this.signature = signature(request); this.rpc = new CodexRpc(usesChrome(request)); }
  async ask(request: EngineRequest): Promise<EngineResult> {
    clearTimeout(this.idle); const resumed = this.started;
    let abortTurn = () => {};
    const abort = () => { abortTurn(); void this.close(); };
    request.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, stageLimitMinutes(request) * 60000);
    try {
      if (!this.thread) {
        await this.rpc.initialize(); request.signal.throwIfAborted();
      }
      // Check the private process's current auth before every generation;
      // a stale UI health result must never fall through to API billing.
      const account = await this.rpc.call('account/read', { refreshToken: false });
      if (account.account?.type !== 'chatgpt') throw new Error('Kantor GPT memerlukan login langganan ChatGPT. Jalankan codex login; akses API tidak dipakai.');
      if (!this.thread) {
        const local = request.task.access === 'local';
        const config = { model_reasoning_effort: request.routing.effort, web_search: local && ['ceo', 'frontend', 'backend'].includes(request.role) ? 'live' : 'disabled' };
        const response = await this.rpc.call('thread/start', { model: request.routing.model, allowProviderModelFallback: false, cwd: local ? request.task.projectPath : request.task.workspace, approvalPolicy: 'never', sandbox: local ? 'danger-full-access' : 'read-only', ephemeral: true, config, ...(request.task.nativeRoles?.includes(request.role) ? { developerInstructions: systemPrompt(request) } : { baseInstructions: systemPrompt(request) }) });
        this.thread = response.thread.id;
      }
      request.signal.throwIfAborted();
      const before = { ...this.totals };
      const result = await new Promise<StageOutput>((resolve, reject) => {
        let final = '', completed = false, trailingWhitespace = 0;
        const finish = (error?: Error, output?: StageOutput) => { if (completed) return; completed = true; unsubscribe(); error ? reject(error) : resolve(output!); };
        abortTurn = () => finish(new Error(request.signal.aborted ? 'Pekerjaan dihentikan.' : `Tahap GPT melewati batas waktu ${stageLimitMinutes(request)} menit; hasil belum terverifikasi.`));
        const unsubscribe = this.rpc.subscribe((event: RpcEvent) => {
          const params = event.params || {};
          if (event.method === 'connection/closed') return finish(new Error(params.error));
          if (event.method === 'currentTime/read' && event.id !== undefined) { this.rpc.send({ id: event.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } }); return; }
          if (event.id !== undefined && event.method) {
            // In 'never' mode approvals cannot block; browser access denials still reach the role as tool errors.
            if (event.method === 'item/tool/requestUserInput') this.rpc.send({ id: event.id, result: { answers: Object.fromEntries((params.questions || []).map((q: any) => [q.id, { answers: ['Return this question in your final JSON questions field; the user answers in the office.'] }])) } });
            else this.rpc.send({ id: event.id, error: { code: -32601, message: 'Put the required user action in your final JSON questions field.' } });
            return;
          }
          if (params.threadId && params.threadId !== this.thread) return;
          if (event.method === 'item/agentMessage/delta') {
            const delta = String(params.delta || '');
            const suffix = delta.match(/\s*$/)![0].length;
            trailingWhitespace = suffix === delta.length ? trailingWhitespace + suffix : suffix;
            if (trailingWhitespace > 8192) {
              finish(new Error('GPT menghasilkan teks kosong berulang. Sesi dihentikan untuk menghemat kuota; hasil belum terverifikasi.'));
              void this.close();
              return;
            }
            request.onOutput(delta);
          }
          if (event.method === 'thread/tokenUsage/updated') { this.totals = params.tokenUsage.total; this.contextSize = params.tokenUsage.last.inputTokens || 0; }
          if (event.method === 'item/started') {
            const item = params.item || {};
            if (item.type === 'commandExecution') request.onOutput(`\n[Bash] ${String(item.command).slice(0, 500)}\n`);
            if (item.type === 'mcpToolCall') request.onOutput(`\n[${item.server}:${item.tool}]\n`);
            if (item.type === 'fileChange') request.onOutput('\n[Edit file project]\n');
          }
          if (event.method === 'item/completed' && params.item?.type === 'agentMessage') final = params.item.text;
          if (event.method === 'item/completed' && params.item?.type === 'mcpToolCall') {
            const item = params.item;
            const chromeBlocked = JSON.stringify([item.error, item.result?.content]).includes('blocking automation because another extension UI is open');
            // Browser calls are the hardest part to diagnose afterwards; keep a short local trace beside the task's reports.
            if (item.server === 'cua_repl' && request.task.workspace) void appendFile(path.join(request.task.workspace, 'browser-trace.jsonl'), JSON.stringify({ time: new Date().toISOString(), role: request.role, code: String(item.arguments?.code || '').slice(0, 2000), error: item.error ? JSON.stringify(item.error).slice(0, 500) : undefined, result: (item.result?.content || []).filter((block: any) => block.type === 'text').map((block: any) => String(block.text)).filter((text: string) => !text.startsWith('## Computer Use') && !text.startsWith('# Other Browser APIs')).join(' | ').slice(0, 1200) }) + '\n').catch(() => {});
            request.onToolDiagnostic?.({ server: item.server, tool: item.tool, arguments: item.arguments, error: item.error, content: item.result?.content?.filter((block: any) => block.type === 'text') });
            if (chromeBlocked) {
              finish(new Error('Chrome menolak kontrol saat pengujian. Biasanya ekstensi lain (misalnya perekam layar) menyisipkan panelnya ke halaman: setel ekstensi itu ke "saat diklik" atau matikan, lalu gunakan Lanjutkan diagnosis. Hasil tetap belum terverifikasi; sesi dihentikan agar tidak menghabiskan kuota.'));
              void this.close();
              return;
            }
          }
          if (event.method === 'turn/completed') {
            if (params.turn?.status !== 'completed') { const reason = String(params.turn?.error?.message || `GPT ${params.turn?.status || 'gagal'}.`); return finish(new Error(/usage limit/i.test(reason) ? `Kuota langganan ChatGPT habis, jadi kantor GPT berhenti sampai kuota pulih. Pesan Codex: ${reason}` : reason)); }
            try {
              const message = [...(params.turn.items || [])].reverse().find((item: any) => item.type === 'agentMessage');
              final = message?.text || final;
              const output = validateOutput(normalizeOutput(JSON.parse(final.replace(/^```json\s*|\s*```$/g, ''))));
              if (request.task.access === 'local' && output.localVerification) output.localVerification = normalizeVerification(output.localVerification);
              finish(undefined, output);
            } catch (error) { finish(new Error(`Format hasil GPT tidak sesuai: ${(error as Error).message}`)); }
          }
        });
        const input: any[] = [{ type: 'text', text: `${resumed ? 'CONTINUE YOUR EARLIER SESSION. Keep your prior exploration; apply the newest user answers.\n' : ''}USER BRIEF:\n${request.task.prompt}\nPROJECT CONTEXT:\n${request.context}\nDeliver your role output as the specified JSON.` }];
        const images = request.images || [];
        for (const image of images.slice(this.sentImages)) input.push({ type: 'image', url: typeof image === 'string' ? `data:image/png;base64,${image}` : `data:${image.mediaType};base64,${image.data}` });
        this.sentImages = images.length;
        this.rpc.call('turn/start', { threadId: this.thread, input, effort: request.routing.effort, outputSchema: codexOutputSchema(schemaFor(request.role, request.phase, request.task.plan?.needsBackend, request.task.browserTests, request.task.access === 'local')), summary: 'none' }).then(() => { this.started = true; }, error => finish(error));
      });
      const cacheReadTokens = Math.max(0, this.totals.cachedInputTokens - before.cachedInputTokens);
      const cacheWriteTokens = Math.max(0, (this.totals.cacheWriteInputTokens || 0) - (before.cacheWriteInputTokens || 0));
      const inputTokens = Math.max(0, this.totals.inputTokens - before.inputTokens - cacheReadTokens);
      const outputTokens = Math.max(0, this.totals.outputTokens - before.outputTokens);
      if (result.questions.length || request.persist === 'work' && this.contextSize > 0 && this.contextSize <= RESUME_CONTEXT_LIMIT) { this.idle = setTimeout(() => void this.close(), 3600000); this.idle.unref(); }
      else await this.close();
      return { output: result, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, resumed };
    } catch (error) { await this.close(); throw error; }
    finally { clearTimeout(deadline); request.signal.removeEventListener('abort', abort); }
  }
  async close() { clearTimeout(this.idle); if (sessions.get(this.key) === this) sessions.delete(this.key); await this.rpc.close(); }
}
export function closeLiveSession(taskId: string) { for (const [key, session] of [...sessions]) if (key.startsWith(`${taskId}:`)) void session.close(); }
export function closeLiveSessions() { for (const session of [...sessions.values()]) void session.close(); }
export const askGPT: AskEngine = async request => {
  request.signal.throwIfAborted();
  if (request.task.access === 'local' && !request.task.projectPath) throw new Error('Folder kerja project laptop belum dipilih.');
  if (catalog.length && (!catalog.some(model => model.id === request.routing.model) || !catalog.find(model => model.id === request.routing.model)?.efforts.includes(request.routing.effort))) throw new Error(`Model/effort ${request.routing.model} ${request.routing.effort} tidak tersedia di katalog Codex. Periksa koneksi.`);
  const key = `${request.task.id}:${request.role}:${request.phase || 'work'}`;
  let session = sessions.get(key);
  if (session && session.signature !== signature(request)) { await session.close(); session = undefined; }
  if (!session) { session = new RoleSession(key, request); sessions.set(key, session); }
  return session.ask(request);
};
export const askDemo: AskEngine = async ({role, signal, onOutput, phase}) => {
  onOutput('[DEMO] Contoh alur catatan; tanpa memanggil GPT.\n');
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
