import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AGENTS, ENGINEER_ROLES, ROLE_ORDER, type EngineerRole, type Task, type RoleId, type StageOutput, type Snapshot, type EngineHealth, type Question, type Phase, type Attachment } from '../shared/types.js';
import { Store } from './store.js';
import { askClaude, askDemo, closeLiveSession, closeLiveSessions, type AskEngine } from './engine.js';
import { saveFiles, syntaxChecks, ensureSafePath, validateOwnership } from './files.js';
import { INITIAL_DESIGN_SYSTEM, LOCAL_CONVENTIONS, PROJECT_CONVENTIONS, routeStage, TEAM_RULES } from './policy.js';
import { openBrowserQA, type OpenBrowser } from './browser-qa.js';
import { compileContract, ProjectRuntimeError } from './runtime.js';
import { validateOutput } from './schema.js';
import { workingDirectory } from './local-access.js';
import { LocalBrowserRuntime, LocalProjectRuntimeError, terminalQA } from './local-verification.js';

const REPORTS: Record<RoleId, string> = { ceo: 'PLAN.md', pm: 'SPEC.md', designer: 'DESIGN.md', frontend: 'FRONTEND.md', backend: 'BACKEND.md', qa: 'QA.md' };
class NeedsInput extends Error {}
// These kinds skip the build pipeline: one agent leads and QA verifies.
const direct = (task: Task) => task.plan?.kind === 'verify' || task.plan?.kind === 'operate';
const isEngineer = (role: RoleId): role is EngineerRole => ENGINEER_ROLES.includes(role as EngineerRole);
const LIVE_OPS = ` When the work or its cause is in hosting or a running service, do it there yourself: use the provider's CLI or API when this computer has access, otherwise its dashboard through the browser. Restart or redeploy the existing service and read its logs without asking; ask first only for what the stop rules list. A local code change does not reach a deployed environment by itself: state in your handoff how it gets there.`;
const LIVE_REPAIR = ` QA found these live in the user's browser at the tested URL and will retest there after you. Prove the root cause with tools (requests, logs, config, code) before changing anything, and do not edit code that is not at fault.${LIVE_OPS}`;
const IMAGE_TYPES: { mediaType: Attachment['mediaType']; extension: string; matches: (data: Buffer) => boolean }[] = [
  { mediaType: 'image/png', extension: 'png', matches: data => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mediaType: 'image/jpeg', extension: 'jpg', matches: data => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { mediaType: 'image/webp', extension: 'webp', matches: data => data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP' },
];
// Images arrive as data URLs; the real type comes from the file signature, not the declared one.
export function parseImages(images: unknown) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length > 6) throw new Error('Lampirkan maksimal 6 gambar per kiriman.');
  return images.map(value => {
    const prefix = typeof value === 'string' ? /^data:image\/(?:png|jpeg|webp);base64,/.exec(value.slice(0, 40)) : null;
    if (!prefix) throw new Error('Gambar harus PNG, JPEG atau WebP.');
    const data = Buffer.from((value as string).slice(prefix[0].length), 'base64'), type = IMAGE_TYPES.find(item => item.matches(data));
    if (!type) throw new Error('Gambar harus PNG, JPEG atau WebP.');
    if (data.length > 5_000_000) throw new Error('Ukuran tiap gambar maksimal 5 MB.');
    return { data, ...type };
  });
}
function repairOrder(task: Task, roles: RoleId[]): RoleId[] {
  const required = new Set(roles);
  if (required.has('pm')) {
    if (task.plan?.needsBackend) required.add('backend');
    required.add('frontend');
  }
  if (required.has('designer')) required.add('frontend');
  // Shared requirements and tokens must be updated before their consumers.
  return ROLE_ORDER.filter(role => required.has(role));
}
export function mergeTestPatches(existing: NonNullable<Task['browserTests']>, patches: NonNullable<Task['browserTests']>) {
  const merged = new Map(existing.map(test => [test.id, test]));
  for (const test of patches) {
    const previous = merged.get(test.id);
    if (!previous || previous.criterionId !== test.criterionId) throw new Error('Patch QA wajib mempertahankan ID skenario dan kriteria; tidak boleh menduplikasi atau mengganti cakupan diam-diam.');
    merged.set(test.id, test);
  }
  return [...merged.values()];
}

export class Runner {
  tasks: Task[];
  health: EngineHealth = { installed: false, loggedIn: false, provider: 'Memeriksa Claude…' };
  private processing = false;
  private closing = false;
  private drained: Promise<void> = Promise.resolve();
  private active = new Map<string, AbortController>();
  private wake = new Map<string, () => void>();
  constructor(private store: Store, public workspaceRoot: string, private broadcast: (state: Snapshot) => void, private engine: AskEngine = askClaude, private demoEngine: AskEngine = askDemo, private browser: OpenBrowser = openBrowserQA, public localRoot = path.dirname(workspaceRoot)) {
    this.tasks = store.all();
    for (const task of this.tasks) {
      // Preserve old projects but migrate their display/ownership to the frontend role.
      task.stages.forEach(stage => { if ((stage.role as string) === 'programmer') stage.role = 'frontend'; });
      task.files.forEach(file => { if ((file.role as string) === 'programmer') file.role = 'frontend'; });
      task.logs.forEach(log => { if ((log.role as string) === 'programmer') log.role = 'frontend'; });
      // Earlier builds counted cache reads as input, exhausting budgets on replayed prompts.
      if (!task.cacheReadExcluded) {
        for (const item of task.usage || []) { const read = Math.min(item.inputTokens, item.cacheReadTokens || 0); item.inputTokens -= read; task.inputTokens = Math.max(0, task.inputTokens - read); }
        task.cacheReadExcluded = true; store.save(task);
      }
      // Earlier builds lacked structured defect ownership; never route an explicit QA defect to an engineer.
      if (task.findings?.some(finding => finding.role === 'frontend' && finding.summary.startsWith('QA:'))) {
        task.findings.forEach(finding => { if (finding.summary.startsWith('QA:')) finding.role = 'qa'; });
        task.pendingFixes = [...new Set(task.findings.map(finding => finding.role))];
      }
      for (const role of ROLE_ORDER) if (!task.stages.some(stage => stage.role === role)) task.stages.push({ role, status: 'skipped', summary: 'Tidak tersedia pada versi project lama.' });
      if (task.status === 'done' && task.plan?.kind !== 'answer' && !direct(task) && !task.browserEvidence?.length && !task.terminalEvidence?.length) { task.status = 'needs_attention'; task.error = 'Project lama belum memiliki bukti QA browser. File tetap tersedia; belum terverifikasi dengan aturan baru.'; this.changed(task); }
      // Successful earlier reviews retained their old repair findings in the live task.
      // Keep that history in review artifacts, not in the active repair queue.
      if (task.status === 'done' && task.criteria?.length && task.checks.every(check => check.passed) &&
        task.criteria.every(criterion => (task.terminalEvidence || task.browserEvidence)?.some(evidence => evidence.criterionId === criterion.id && evidence.passed)) &&
        (task.findings?.length || task.pendingFixes?.length)) {
        task.findings = []; task.pendingFixes = []; this.changed(task);
      }
      delete task.previewUrl;
      if (['queued', 'running', 'pausing', 'paused'].includes(task.status)) {
        task.status = 'stopped'; task.pauseRequested = false; task.error = 'Server dimulai ulang; pekerjaan tidak diputar ulang otomatis. File tetap tersimpan.';
        task.stages.forEach(stage => { if (stage.status === 'working') stage.status = 'failed'; });
        this.log(task, 'system', 'info', task.error);
      }
    }
  }
  snapshot(): Snapshot { return { tasks: [...this.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), health: this.health, workspaceRoot: this.workspaceRoot, localRoot: this.localRoot }; }
  changed(task?: Task) { if (task) { task.updatedAt = new Date().toISOString(); this.store.save(task); } this.broadcast(this.snapshot()); }
  log(task: Task, role: RoleId | 'system', type: Task['logs'][number]['type'], text: string) {
    task.logs.push({ id: randomUUID(), role, type, text: text.slice(0, 24000), time: new Date().toISOString() });
    if (task.logs.length > 400) task.logs.splice(0, task.logs.length - 400);
    this.changed(task);
  }
  private async persist(task: Task, files: { path: string; content: string }[], role: RoleId) {
    const saved = await saveFiles(task.workspace, files, role);
    for (const file of saved) { task.files = [...task.files.filter(existing => existing.path !== file.path), file]; this.log(task, role, 'file', `${file.path} tersimpan · ${file.bytes.toLocaleString('id-ID')} byte`); }
  }
  async create(prompt: string, mode: 'claude' | 'demo', tokenBudget = 300000, options?: { access?: 'local' | 'generated'; projectPath?: string; images?: unknown; nativeRoles?: RoleId[] }) {
    const images = parseImages(options?.images);
    if (this.closing) throw new Error('Kantor sedang ditutup.');
    if (mode === 'claude' && !this.health.loggedIn) throw new Error('Claude belum login. Periksa koneksi di pengaturan.');
    const local = mode === 'claude' && options?.access === 'local';
    const projectPath = local ? await workingDirectory(options?.projectPath || this.localRoot, this.localRoot) : undefined;
    const id = randomUUID(), workspace = path.join(this.workspaceRoot, id), time = new Date().toISOString();
    await mkdir(workspace, { recursive: true });
    if (this.closing) throw new Error('Kantor sedang ditutup.');
    const task: Task = { id, prompt, title: mode === 'demo' ? 'Demo · Aplikasi catatan' : prompt.slice(0, 75), mode, access: local ? 'local' : 'generated', projectPath, status: 'queued', stages: ROLE_ORDER.map(role => ({ role, status: 'waiting' })), logs: [], files: [], checks: [], createdAt: time, updatedAt: time, workspace, inputTokens: 0, outputTokens: 0, retry: 0, usage: [], clarifications: [], browserEvidence: [], revisionLimit: 6, tokenBudget, cacheReadExcluded: true, failureCounts: {}, ...(local && options?.nativeRoles?.length ? { nativeRoles: [...new Set(options.nativeRoles)] } : {}) };
    this.tasks.push(task); this.attach(task, images);
    await this.persist(task, [ { path: 'BRIEF.md', content: `# Brief\n\n${prompt}\n\nMode: ${mode}${local ? `\nFolder kerja: ${projectPath}\nAkses laptop penuh (hak akun pengguna)` : ''}\n` }, { path: 'TEAM-RULES.md', content: TEAM_RULES }, { path: 'CONVENTIONS.md', content: local ? LOCAL_CONVENTIONS : PROJECT_CONVENTIONS }, { path: 'DESIGN-SYSTEM.md', content: local ? '# Design system\n\nPelajari dan ikuti design system project yang dipilih. Jangan menggantinya dengan tema kantor.\n' : INITIAL_DESIGN_SYSTEM } ], 'ceo');
    this.log(task, 'system', 'info', mode === 'demo' ? 'Demo tanpa AI; pemeriksaan browser tetap dijalankan.' : 'Maksimalkan hasil, minimalkan usage. Scope jelas, kontrak bersama, verifikasi browser.');
    void this.process(); return task;
  }
  private attach(task: Task, images: ReturnType<typeof parseImages>) {
    if (!images.length) return;
    if ((task.attachments?.length || 0) + images.length > 12) throw new Error('Satu tugas menampung maksimal 12 gambar.');
    mkdirSync(path.join(task.workspace, 'attachments'), { recursive: true });
    for (const image of images) {
      const file = `attachments/${(task.attachments?.length || 0) + 1}.${image.extension}`;
      writeFileSync(path.join(task.workspace, file), image.data);
      task.attachments = [...(task.attachments || []), { path: file, mediaType: image.mediaType }];
    }
    this.log(task, 'system', 'info', `${images.length} gambar dari lu dilampirkan untuk tim.`);
  }
  answer(id: string, clarificationId: string, answers: Record<string, string>, images?: unknown) {
    const task = this.tasks.find(t => t.id === id);
    const clarification = task?.clarifications?.find(item => item.id === clarificationId && !item.answers);
    if (!task || task.status !== 'awaiting_input' || !clarification) throw new Error('Pertanyaan sudah dijawab atau tidak tersedia.');
    if (Object.keys(answers).some(key => !clarification.questions.some(question => question.id === key)) || clarification.questions.some(question => typeof answers[question.id] !== 'string' || !answers[question.id].trim() || answers[question.id].length > 3000)) throw new Error('Jawab setiap pertanyaan, maksimal 3000 karakter per jawaban.');
    this.attach(task, parseImages(images));
    clarification.answers = Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, value.trim()]));
    task.status = 'queued'; task.error = undefined;
    task.stages.find(stage => stage.role === clarification.role)!.status = 'waiting';
    // A manual browser step (e.g. login) or a question asked during a repair resumes that stage; it is not a new product decision.
    if (!clarification.resume && ['backend', 'frontend', 'qa'].includes(clarification.role)) {
      // A late product decision must reach the shared plan/contract, not just one engineer.
      task.stages.forEach(stage => { stage.status = 'waiting'; });
      task.browserTests = undefined; task.browserEvidence = []; task.terminalEvidence = undefined; task.localVerification = undefined; task.checks = [];
    }
    this.log(task, 'system', 'info', 'Jawaban diterima. Tim melanjutkan bagian yang memerlukan klarifikasi.');
    void this.process(); return task;
  }
  action(id: string, action: 'pause' | 'resume' | 'stop' | 'continue', input?: { note?: unknown; images?: unknown }) {
    if (this.closing && action !== 'stop') throw new Error('Kantor sedang ditutup.');
    const task = this.tasks.find(t => t.id === id);
    if (!task) throw new Error('Tugas tidak ditemukan.');
    if (task.status === 'done' || (task.status === 'stopped' && action !== 'continue')) throw new Error('Tugas sudah berakhir.');
    if (action === 'continue') {
      if (!['needs_attention', 'failed', 'stopped'].includes(task.status)) throw new Error('Tugas belum membutuhkan kelanjutan.');
      if (input?.note !== undefined && (typeof input.note !== 'string' || input.note.length > 3000)) throw new Error('Pesan untuk tim maksimal 3000 karakter.');
      this.attach(task, parseImages(input?.images));
      if (input?.note?.trim()) { task.notes = [...(task.notes || []), { text: input.note.trim(), time: new Date().toISOString() }]; this.log(task, 'system', 'info', `Pesan lu untuk tim: ${input.note.trim()}`); }
      task.pauseRequested = false;
      const pendingQuestion = task.clarifications?.find(item => !item.answers);
      if (pendingQuestion) {
        task.status = 'awaiting_input'; task.error = undefined;
        task.stages.find(stage => stage.role === pendingQuestion.role)!.status = 'waiting_input';
        this.log(task, 'system', 'info', 'Pertanyaan yang belum dijawab ditampilkan kembali; tidak memanggil agent lagi.');
        return task;
      }
      if (task.inputTokens + task.outputTokens >= (task.tokenBudget || 120000)) task.tokenBudget = task.inputTokens + task.outputTokens + 50000;
      task.revisionLimit = Math.max(task.revisionLimit || 6, task.retry + 3); task.status = 'queued'; task.error = undefined;
      this.log(task, 'system', 'info', 'Melanjutkan diagnosis dan perbaikan; status tetap belum siap sampai semua verifikasi lulus.');
      void this.process();
    } else if (action === 'pause') {
      if (task.status !== 'running') throw new Error('Hanya tugas aktif yang bisa dijeda.');
      task.pauseRequested = true; task.status = 'pausing'; this.log(task, 'system', 'info', 'Tahap aktif diselesaikan dahulu, lalu tim dijeda.');
    } else if (action === 'resume') {
      if (!['paused', 'pausing'].includes(task.status)) throw new Error('Tugas ini tidak dijeda.');
      task.pauseRequested = false; task.status = 'running'; this.wake.get(id)?.(); this.wake.delete(id); this.log(task, 'system', 'info', 'Tim melanjutkan pekerjaan.');
    } else {
      task.pauseRequested = false; task.status = 'stopped'; this.active.get(id)?.abort(); closeLiveSession(id); this.wake.get(id)?.(); this.wake.delete(id);
      task.stages.forEach(stage => { if (stage.status === 'working') stage.status = 'waiting'; });
      this.log(task, 'system', 'info', 'Pekerjaan dihentikan; file yang sudah tersimpan tetap ada.');
    }
    this.changed(task); return task;
  }
  private async gate(task: Task, signal: AbortSignal) {
    signal.throwIfAborted();
    if (task.pauseRequested) { task.status = 'paused'; this.changed(task); await new Promise<void>(resolve => this.wake.set(task.id, resolve)); }
    signal.throwIfAborted(); if (task.status === 'stopped') throw new Error('Pekerjaan dihentikan.');
  }
  private askQuestions(task: Task, role: RoleId, questions: Question[], resume = false) {
    if (questions.length > 5 || questions.some(question => !question.id || !question.question.trim()) || new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Pertanyaan klarifikasi tidak valid.');
    task.clarifications ||= []; task.clarifications.push({ id: randomUUID(), role, questions, ...(resume ? { resume } : {}) });
    task.status = 'awaiting_input'; task.stages.find(stage => stage.role === role)!.status = 'waiting_input';
    this.log(task, role, 'info', `Butuh klarifikasi: ${questions.map(question => question.question).join(' · ')}`);
    throw new NeedsInput();
  }
  private async context(task: Task, role: RoleId) {
    const dependencies: Record<RoleId, string[]> = {
      ceo: ['CONVENTIONS.md'], pm: ['PLAN.md', 'CONVENTIONS.md'], designer: ['SPEC.md', 'DESIGN-SYSTEM.md', 'CONVENTIONS.md'],
      backend: ['SPEC.md', 'CONTRACT.json', 'CONVENTIONS.md'], frontend: ['SPEC.md', 'DESIGN-SYSTEM.md', 'CONTRACT.json', 'CONVENTIONS.md'], qa: ['SPEC.md', 'DESIGN-SYSTEM.md', 'CONTRACT.json', 'CONVENTIONS.md'],
    };
    // Laptop agents already receive the current conventions in their role prompt.
    const unspecified = role !== 'ceo' && !task.files.some(file => file.path === 'SPEC.md');
    const artifacts = task.files.filter(file => (file.path !== 'CONVENTIONS.md' || task.access !== 'local') && (file.path !== 'CONTRACT.json' || task.plan?.needsBackend) && (file.role !== 'backend' || task.plan?.needsBackend) && (dependencies[role].includes(file.path) || unspecified && file.path === 'PLAN.md' || (['frontend', 'backend', 'qa', 'designer'].includes(role) && (file.role === role || role === 'qa' || role === 'designer') && ['frontend', 'backend'].includes(file.role))));
    const files = await Promise.all(artifacts.map(async file => `FILE ${file.path}:\n${await readFile(await ensureSafePath(task.workspace, file.path), 'utf8')}`));
    return `${task.access === 'local' ? `REAL WORKING DIRECTORY: ${task.projectPath}\nOFFICE REPORT DIRECTORY: ${task.workspace}\nUse native tools to inspect the actual project. The office report directory is separate from working files.\n` : ''}${files.join('\n\n')}\nPLAN: ${JSON.stringify(task.plan || {})}\nCRITERIA: ${JSON.stringify(task.criteria || [])}\nUSER CLARIFICATIONS: ${JSON.stringify(task.clarifications?.filter(item => item.answers) || [])}\nCURRENT QA FINDINGS: ${JSON.stringify(task.findings || [])}${task.notes?.length ? `\nUSER FOLLOW-UP MESSAGES (newest last; they refine the brief): ${JSON.stringify(task.notes)}` : ''}${task.attachments?.length ? `\nUSER IMAGES: ${task.attachments.length} image(s) from the user are attached to this message in this order: ${task.attachments.map(file => path.join(task.workspace, file.path)).join(', ')}` : ''}`;
  }
  private async stage(task: Task, role: RoleId, controller: AbortController, extra = '', phase: Phase = 'work', images?: string[]): Promise<StageOutput> {
    await this.gate(task, controller.signal);
    if (task.mode === 'claude' && task.inputTokens + task.outputTokens >= (task.tokenBudget || 120000)) throw new Error('Batas token project tercapai. Tim berhenti sebelum panggilan berikutnya; hasil belum siap. Lanjutkan diagnosis untuk menambah anggaran 50.000 token tercatat.');
    const stage = task.stages.find(item => item.role === role)!;
    const chrome = task.access === 'local' && isEngineer(role) && !!task.browserRoles?.includes(role);
    // Work returns to hands-on roles in repair rounds; planners only wait when they ask a question.
    const persist = task.access === 'local' && task.mode === 'claude' && phase === 'work' ? isEngineer(role) ? 'work' as const : 'question' as const : undefined;
    const routing = routeStage(task, role, task.failureCounts?.[role] || 0), start = Date.now();
    stage.status = 'working'; stage.routing = routing;
    this.log(task, role, 'info', `${AGENTS.find(agent => agent.id === role)!.name} · ${routing.model.replace('claude-', '')} · ${routing.effort}: ${routing.reason}`);
    let chunk = '', timer: ReturnType<typeof setTimeout> | undefined, invoked = false, recorded = false;
    const flush = () => { if (chunk) this.log(task, role, 'output', chunk); chunk = ''; timer = undefined; };
    try {
      const context = await this.context(task, role) + '\n' + extra;
      if (context.length > 150000) throw new Error('Konteks terlalu besar; pecah pekerjaan menjadi bagian lebih kecil.');
      const attached = task.mode === 'demo' ? [] : await Promise.all((task.attachments || []).filter(file => /^attachments\/\d+\.(png|jpg|webp)$/.test(file.path)).map(async file => ({ data: (await readFile(path.join(task.workspace, file.path))).toString('base64'), mediaType: file.mediaType })));
      controller.signal.throwIfAborted();
      invoked = true;
      const result = await (task.mode === 'demo' ? this.demoEngine : this.engine)({ role, task, context, signal: controller.signal, routing, phase, chrome, persist, images: [...attached, ...(images || [])], onOutput: text => { chunk = (chunk + text).slice(-24000); if (!timer) timer = setTimeout(flush, 800); } });
      if (timer) clearTimeout(timer); flush(); controller.signal.throwIfAborted();
      task.inputTokens += result.inputTokens; task.outputTokens += result.outputTokens;
      task.usage ||= []; task.usage.push({ role, phase, ...routing, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cacheReadTokens: result.cacheReadTokens || 0, cacheWriteTokens: result.cacheWriteTokens || 0, durationMs: Date.now() - start, retry: task.retry, status: 'complete', measured: true, ...(task.nativeRoles?.includes(role) ? { native: true } : {}), ...(chrome || phase === 'live' ? { chrome: true } : {}), ...(result.resumed ? { resumed: true } : {}) }); recorded = true;
      this.changed(task);
      const output = validateOutput(result.output);
      if (output.needsBrowser && !chrome && task.access === 'local' && isEngineer(role)) {
        // The work turned out to live on a website; give this role the browser and let it continue.
        task.browserRoles = [...(task.browserRoles || []), role];
        this.log(task, role, 'info', `${AGENTS.find(agent => agent.id === role)!.name} butuh browser untuk melanjutkan: ${output.summary}`);
        return this.stage(task, role, controller, extra, phase, images);
      }
      if (output.questions.length) this.askQuestions(task, role, output.questions, phase === 'live' || !!task.pendingFixes?.includes(role));
      if (task.access === 'local' && output.files.length) throw new Error('Project laptop harus diedit melalui tool langsung; files hanya berlaku untuk mode project sederhana.');
      validateOwnership(role, output.files);
      if (role === 'ceo') { if (!output.plan || task.access === 'local' && !output.plan.kind) throw new Error('CEO belum menyusun klasifikasi dan jenis pekerjaan.'); task.plan = output.plan;
        if (output.plan.kind === 'verify' || output.plan.kind === 'operate') {
          if (task.access !== 'local' || !output.criteria?.length || output.criteria.length > 30 || new Set(output.criteria.map(item => item.id)).size !== output.criteria.length) throw new Error('Tugas langsung wajib punya 1–30 kriteria unik pada project laptop.');
          task.criteria = output.criteria; task.localVerification = { kind: 'live' };
        }
        if (output.plan.kind === 'operate') {
          const lead = output.plan.lead;
          if (!lead || !isEngineer(lead)) throw new Error('Tugas operasional wajib punya pemimpin: designer, frontend atau backend.');
          // The lead works first through the repair loop; QA verifies the criteria afterwards.
          task.findings = [{ role: lead, summary: 'Tugas operasional dari user', reproduction: task.prompt, expected: output.criteria!.map(criterion => criterion.description).join(' '), actual: 'Belum dikerjakan.' }];
          task.pendingFixes = [lead]; task.retry = 0;
          if (output.plan.browser) task.browserRoles = [...new Set([...(task.browserRoles || []), lead])];
        }
        // Small clear work needs no separate requirements call: the planner's criteria are the specification.
        if (output.plan.kind === 'work' && task.access === 'local' && output.plan.complexity === 'clear' && !output.plan.needsBackend && !output.plan.needsDesign && output.criteria?.length) {
          if (output.criteria.length > 30 || new Set(output.criteria.map(item => item.id)).size !== output.criteria.length) throw new Error('Kriteria wajib unik dan maksimal 30.');
          if (JSON.stringify(task.criteria) !== JSON.stringify(output.criteria)) { task.browserTests = undefined; task.localVerification = undefined; }
          task.criteria = output.criteria; this.skip(task, 'pm', `Scope kecil dan jelas; kriteria ditulis ${AGENTS.find(agent => agent.id === 'ceo')!.name}.`);
        }
      }
      if (role === 'pm') {
        if (!output.criteria?.length || output.criteria.length > 30 || new Set(output.criteria.map(item => item.id)).size !== output.criteria.length) throw new Error('Spek wajib punya 1–30 kriteria penerimaan unik.');
        if (JSON.stringify(task.criteria) !== JSON.stringify(output.criteria)) { task.browserTests = undefined; task.localVerification = undefined; }
        task.criteria = output.criteria;
        if (task.plan?.needsBackend && task.access !== 'local') { if (!output.contract) throw new Error('Spek backend belum memiliki kontrak API.'); compileContract(output.contract); task.contract = output.contract; await this.persist(task, [{ path: 'CONTRACT.json', content: JSON.stringify(output.contract, null, 2) }], 'pm'); }
        else task.contract = undefined;
      }
      // The engineer who built it knows how to run it; QA still tests independently. Terminal tests stay QA's to write.
      if (task.access === 'local' && isEngineer(role) && task.plan?.kind === 'work' && output.localVerification?.kind === 'live') task.localVerification = output.localVerification;
      await this.persist(task, [{ path: REPORTS[role], content: output.markdown }, ...output.files], role);
      if (task.access === 'local') for (const location of output.changedFiles || []) {
        if (location.includes('\0') || location.length > 4096) throw new Error('Lokasi perubahan tidak valid.');
        const absolute = path.resolve(task.projectPath!, location);
        task.changedFiles = [...(task.changedFiles || []).filter(file => file.path !== absolute), { path: absolute, role }];
      }
      controller.signal.throwIfAborted();
      stage.status = 'done'; stage.summary = output.summary; this.log(task, role, 'info', output.summary); return output;
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (invoked && !recorded) { task.usage ||= []; task.usage.push({ role, phase, ...routing, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: Date.now() - start, retry: task.retry, status: controller.signal.aborted ? 'interrupted' : 'failed', measured: false }); }
      if (!(error instanceof NeedsInput) && !controller.signal.aborted) { flush(); stage.status = 'failed'; }
      throw error;
    }
  }
  private skip(task: Task, role: RoleId, reason: string) { const stage = task.stages.find(item => item.role === role)!; stage.status = 'skipped'; stage.summary = reason; this.changed(task); }
  private async process() {
    if (this.processing || this.closing) return; this.processing = true;
    let finish = () => {};
    this.drained = new Promise<void>(resolve => { finish = resolve; });
    try { let task: Task | undefined; while (!this.closing && (task = this.tasks.find(item => item.status === 'queued'))) await this.run(task); }
    finally { this.processing = false; finish(); }
  }
  private async browserArtifacts(task: Task) {
    const folder = path.join(task.workspace, 'qa', `run-${task.retry}`);
    try {
      for (const name of await readdir(folder)) {
        if (!/^(case-\d+|mobile)\.png$/.test(name)) continue;
        const relative = `qa/run-${task.retry}/${name}`, bytes = (await stat(await ensureSafePath(task.workspace, relative))).size;
        task.files = [...task.files.filter(file => file.path !== relative), { path: relative, bytes, role: 'qa' }];
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private async run(task: Task) {
    const controller = new AbortController(); this.active.set(task.id, controller); task.status = 'running'; this.changed(task);
    try {
      for (const role of ['ceo', 'pm', 'designer', 'backend', 'frontend'] as RoleId[]) {
        if (role !== 'ceo' && (task.plan?.kind === 'answer' || direct(task))) break;
        // Pending repairs carry their own context and must not also run as initial work.
        if (task.pendingFixes?.includes(role)) continue;
        const current = task.stages.find(stage => stage.role === role);
        const needsComplexPlanReview = role === 'ceo' && task.plan?.complexity === 'complex' && current?.routing?.model !== 'claude-opus-5-5';
        if (current?.status === 'done' && !needsComplexPlanReview && !(role === 'ceo' && !task.plan) && !(role === 'pm' && !task.criteria?.length)) continue;
        if (role === 'pm' && current?.status === 'skipped' && task.criteria?.length) continue;
        if (role === 'backend' && !task.plan?.needsBackend) { this.skip(task, role, 'Scope ini tidak membutuhkan backend.'); continue; }
        if (role === 'designer' && !task.plan?.needsDesign) { this.skip(task, role, 'Menggunakan design system yang sudah ada.'); continue; }
        await this.stage(task, role, controller);
        if (role === 'ceo' && task.plan?.complexity === 'complex' && current?.routing?.model !== 'claude-opus-5-5') {
          await this.stage(task, role, controller, 'The first pass identified genuinely complex work. Reassess the architecture, dependencies and risk with Opus before handing the plan to PM. Preserve agreed scope and ask only for unresolved product decisions.');
        }
      }
      if (task.plan?.kind === 'answer') {
        task.answer = await readFile(await ensureSafePath(task.workspace, 'PLAN.md'), 'utf8');
        if (!task.answer.trim()) throw new Error('Agent belum memberikan jawaban.');
        for (const role of ROLE_ORDER.filter(role => role !== 'ceo')) this.skip(task, role, 'Pertanyaan dijawab langsung oleh CEO; tidak membutuhkan implementasi.');
        task.status = 'done'; task.error = undefined; task.findings = []; task.pendingFixes = [];
        this.log(task, 'system', 'info', 'Jawaban selesai. Pertanyaan tidak diteruskan ke alur pembuatan aplikasi.'); return;
      }
      if (direct(task)) for (const role of ['pm', 'designer', 'backend', 'frontend'] as RoleId[]) if (!task.pendingFixes?.includes(role) && task.stages.find(stage => stage.role === role)?.status === 'waiting') this.skip(task, role, 'Tidak memimpin tugas ini; dipanggil hanya bila QA menemukan cacat miliknya.');
      while (true) {
        await this.gate(task, controller.signal);
        if (task.pendingFixes?.length) {
          task.pendingFixes = repairOrder(task, task.pendingFixes);
          for (const role of task.pendingFixes) {
            if (role === 'qa') {
              if (task.access === 'local' && task.localVerification && task.localVerification.kind !== 'terminal' && task.checks.some(check => check.name === 'Runtime project' && !check.passed)) {
                const correction = await this.stage(task, 'qa', controller, `Correct the defective server command/URL configuration without changing application implementation. Preserve browser verification.\nCURRENT CONFIG:\n${JSON.stringify(task.localVerification)}\nSTARTUP FAILURE:\n${JSON.stringify(task.checks)}`, 'prepare');
                if (correction.localVerification?.kind !== task.localVerification.kind) throw new Error('Perbaikan konfigurasi server harus mempertahankan verifikasi browser.');
                task.localVerification = correction.localVerification;
              }
              if (task.access === 'local' && task.localVerification?.kind === 'terminal') {
                const correction = await this.stage(task, 'qa', controller, `Correct only defective terminal tests with the SAME ids and criterionIds.\n${JSON.stringify(task.terminalEvidence)}\n${JSON.stringify(task.localVerification)}`, 'prepare');
                const existing = new Map(task.localVerification.terminalTests?.map(test => [test.id, test]));
                for (const test of correction.localVerification?.terminalTests || []) {
                  if (existing.get(test.id)?.criterionId !== test.criterionId) throw new Error('Patch terminal wajib mempertahankan ID dan kriteria.');
                  existing.set(test.id, test);
                }
                task.localVerification.terminalTests = [...existing.values()];
              }
              if (task.browserTests?.length) {
                const failedIds = new Set(task.browserEvidence?.filter(item => !item.passed).map(item => item.id));
                const correction = await this.stage(task, 'qa', controller, `Correct the test defects, not application code. Return browserTests containing ONLY corrected cases with the SAME ids. ${task.access === 'local' ? 'Browser contexts are fresh; actual backend data can persist. Prepare and clean up state through the supported UI/API; seedData is unavailable.' : 'Each case has fresh data. seedData accepts body or value JSON.'} The page is already loaded before steps. Request counts include the initial page load and any goto/reload. CSS computed display can be blockified inside flex containers; test visibility when that is the actual requirement.\nFAILED CASES:\n${JSON.stringify(task.browserTests.filter(test => failedIds.has(test.id)))}\nACTUAL FAILURES:\n${JSON.stringify(task.browserEvidence?.filter(item => !item.passed))}`, 'test-plan');
                task.browserTests = mergeTestPatches(task.browserTests, correction.browserTests || []);
              }
              task.pendingFixes = task.pendingFixes.filter(pending => pending !== role); this.changed(task);
              continue;
            }
            await this.stage(task, role, controller, task.plan?.kind === 'operate' && task.retry === 0
              ? `LEAD THIS TASK: you own it end to end. Do what the user asked, confirm the outcome yourself, and hand over what you did and observed; QA then verifies every criterion.${LIVE_OPS}\nCRITERIA TO REACH: ${JSON.stringify(task.criteria)}`
              : `REPAIR: Diagnose the root cause using these concrete failures. Return only changed owned files.${task.localVerification?.kind === 'live' ? LIVE_REPAIR : ''}\n${JSON.stringify(task.findings)}\nCHECKS:\n${JSON.stringify(task.checks)}`);
            task.pendingFixes = task.pendingFixes.filter(pending => pending !== role); this.changed(task);
          }
          task.pendingFixes = []; this.changed(task);
        }
        if (task.access === 'local' && !task.localVerification) {
          const prepared = await this.stage(task, 'qa', controller, 'Prepare host-executed verification for this actual project.', 'prepare');
          if (!prepared.localVerification) throw new Error('QA belum menyediakan verifikasi project laptop.');
          task.localVerification = prepared.localVerification; this.changed(task);
        }
        task.checks = task.access === 'local' ? [] : await syntaxChecks(task.workspace, task.files);
        let images: string[] = [], review: StageOutput | undefined;
        if (task.access === 'local' && task.localVerification?.kind === 'live') {
          const runtime = new LocalBrowserRuntime(task, controller.signal, text => this.log(task, 'qa', 'check', text));
          // A retest starts in a fresh session; its own earlier steps let it go straight to what worked.
          const earlier = task.browserEvidence?.length ? `\nYOUR PREVIOUS RUN (reuse the steps that worked; every criterion is still re-checked now): ${JSON.stringify(task.browserEvidence).slice(0, 6000)}` : '';
          task.browserEvidence = []; task.terminalEvidence = undefined;
          try {
            if (task.localVerification.serverCommand || task.localVerification.url) await runtime.start();
            review = await this.stage(task, 'qa', controller, `USER BRIEF: ${task.prompt}\nTARGET URL: ${runtime.url || 'the URL in the brief or the answered clarifications; ask when neither names one'}\nTest every criterion live in the user's Chrome now.${earlier}`, 'live');
            task.browserEvidence = review.liveEvidence || [];
            await this.persist(task, [{ path: `qa/run-${task.retry}/evidence.json`, content: JSON.stringify(task.browserEvidence, null, 2) }], 'qa');
          } catch (error) {
            if (!(error instanceof LocalProjectRuntimeError)) throw error;
            task.checks.push({ name: 'Runtime project', passed: false, detail: error.message });
          } finally { await runtime.stop(); }
        } else if (task.access === 'local' && task.localVerification?.kind === 'terminal') {
          const report = await terminalQA(task, controller.signal, text => this.log(task, 'qa', 'check', text));
          task.terminalEvidence = report.evidence; task.browserEvidence = []; task.checks = report.checks;
          await this.persist(task, [{ path: `qa/run-${task.retry}/terminal-evidence.json`, content: JSON.stringify(report.evidence, null, 2) }], 'qa');
        } else if (task.checks.every(check => check.passed)) {
          let session;
          try { session = await this.browser(task, controller.signal, text => { task.stages.find(stage => stage.role === 'qa')!.status = 'working'; this.log(task, 'qa', 'check', text); }); }
          catch (error) {
            if (!(error instanceof ProjectRuntimeError)) throw error;
            task.checks.push({ name: task.access === 'local' ? 'Runtime project' : 'Runtime backend', passed: false, detail: error.message }); task.browserEvidence = [];
          }
          if (session) {
          try {
            const snapshot = await session.inspect();
            if (!task.browserTests?.length) {
              const plan = await this.stage(task, 'qa', controller, `LIVE BROWSER DOM:\n${snapshot}\nISOLATION: ${task.access === 'local' ? 'Each case has a fresh browser context; backend data can persist. Prepare and clean up test state through the actual UI/API. seedData is unavailable.' : 'Every case starts with empty backend data and a fresh browser context.'}\nReturn an executable test plan for EVERY acceptance criterion.`, 'test-plan');
              task.browserTests = plan.browserTests || []; this.changed(task);
            }
            const report = await session.run(task.browserTests);
            controller.signal.throwIfAborted(); task.browserEvidence = report.evidence; task.checks.push(...report.checks); images = report.images;
            await this.browserArtifacts(task);
            await this.persist(task, [{ path: `qa/run-${task.retry}/evidence.json`, content: JSON.stringify(report.evidence, null, 2) }], 'qa');
          } finally { await session.close(); }
          }
        } else task.browserEvidence = [];
        const evidence = task.localVerification?.kind === 'terminal' ? task.terminalEvidence : task.browserEvidence;
        review ||= await this.stage(task, 'qa', controller, `TEST ISOLATION: ${task.access === 'local' ? 'Actual existing project; browser contexts are fresh, backend state is prepared through supported UI/API. Terminal tests run in the actual working directory.' : 'Every scenario was run with fresh empty backend data and fresh browser storage.'} Incorrect test assumptions are QA defects.\nACTUAL EXECUTION RESULTS:\n${JSON.stringify(task.checks)}\nEXECUTION EVIDENCE:\n${JSON.stringify(evidence)}\nDo not pass if any required check failed, criteria lack coverage, or tests did not run.`, 'review', images);
        await this.persist(task, [{ path: `qa/run-${task.retry}/review.md`, content: review.markdown }], 'qa');
        if (direct(task)) task.answer = review.markdown;
        const covered = task.criteria?.every(criterion => evidence?.some(item => item.criterionId === criterion.id && item.passed));
        if (review.verdict === 'pass' && !review.findings?.length && !review.issues.length && task.checks.every(check => check.passed) && covered && evidence?.length) {
          task.status = 'done'; task.error = undefined; task.pendingFixes = []; task.findings = [];
          this.log(task, 'system', 'info', `Siap: seluruh kriteria tercakup, pemeriksaan ${task.localVerification?.kind === 'terminal' ? 'terminal' : task.localVerification?.kind === 'live' ? 'browser live' : 'browser'} nyata lulus, serta review QA selesai.`); break;
        }
        task.stages.find(stage => stage.role === 'qa')!.status = 'failed';
        const failed = task.checks.filter(check => !check.passed);
        const correctedTests = review.browserTests?.length && review.findings?.some(finding => finding.role === 'qa');
        if (correctedTests) {
          task.browserTests = mergeTestPatches(task.browserTests || [], review.browserTests!);
        }
        task.findings = review.findings?.length ? review.findings : [{ role: 'qa', summary: review.issues.join('; ') || failed.map(check => check.name).join('; ') || 'QA belum memberikan diagnosis dengan pemilik masalah.', reproduction: failed.map(check => check.detail).join('\n'), expected: 'Temuan spesifik, pemilik masalah, dan bukti pengujian.', actual: 'Review belum cukup untuk menentukan revisi kode.' }];
        // QA flags a defect whose fix lives on a website so its owner starts with the browser.
        for (const finding of task.findings) if (finding.fixInBrowser && isEngineer(finding.role) && !task.browserRoles?.includes(finding.role)) task.browserRoles = [...(task.browserRoles || []), finding.role];
        const defectOwners = new Set(task.findings.map(finding => finding.role));
        if (correctedTests) defectOwners.delete('qa');
        // Schema/contract or backend syntax defects must be repaired by their owner.
        if (failed.some(check => /backend|kontrak/i.test(check.name)) && task.plan?.needsBackend && !defectOwners.has('pm')) defectOwners.add('backend');
        if (task.localVerification?.kind === 'live' && ![...defectOwners].some(role => role !== 'qa')) {
          // Retesting unchanged code in the browser cannot change the result; wait for the user's direction.
          const missing = (task.criteria || []).filter(criterion => !evidence?.some(item => item.criterionId === criterion.id && item.passed));
          task.pendingFixes = []; task.status = 'needs_attention';
          task.error = `Pengecekan browser belum lulus${missing.length ? `: ${missing.map(criterion => criterion.id).join(', ')}` : ''}. QA tidak menemukan cacat untuk engineer; lihat laporan QA, lalu lanjutkan dengan arahan untuk menguji ulang di Chrome.`;
          this.log(task, 'system', 'error', task.error); break;
        }
        task.pendingFixes = repairOrder(task, [...defectOwners]);
        task.failureCounts ||= {};
        // Dependent updates are not failures of the engineer applying them.
        for (const role of defectOwners) task.failureCounts[role] = (task.failureCounts[role] || 0) + 1;
        if (task.retry >= (task.revisionLimit || 6)) { task.status = 'needs_attention'; task.error = `Batas percobaan tercapai; hasil belum siap. ${task.findings.map(finding => finding.summary).join('; ')}. Lanjutkan untuk meneruskan diagnosis dan perbaikan.`; this.log(task, 'system', 'error', task.error); break; }
        task.retry++;
        // Preserve regression cases; the QA plan changes only when requirements change.
        this.log(task, 'qa', 'info', `Perbaikan ${task.retry}: ${task.findings.map(finding => finding.summary).join('; ')}. Uji ulang seluruh skenario setelah perbaikan.`);
      }
    } catch (error) {
      if (!(error instanceof NeedsInput) && !controller.signal.aborted) {
        task.status = 'needs_attention'; task.error = error instanceof Error ? error.message : String(error);
        this.log(task, 'system', 'error', `Belum terverifikasi: ${task.error}`);
      }
    } finally {
      this.active.delete(task.id);
      // Nothing returns to these agents once the task has ended.
      if (['done', 'stopped', 'failed'].includes(task.status)) closeLiveSession(task.id);
      this.changed(task);
    }
  }
  async shutdown() {
    this.closing = true;
    for (const task of this.tasks) if (['queued', 'running', 'pausing', 'paused'].includes(task.status)) this.action(task.id, 'stop');
    await this.drained; closeLiveSessions();
  }
}
