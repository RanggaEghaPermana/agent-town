export type RoleId = 'ceo' | 'pm' | 'designer' | 'frontend' | 'backend' | 'qa';
export type TaskStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'awaiting_input' | 'needs_attention' | 'done' | 'failed' | 'stopped';
export type StageStatus = 'waiting' | 'working' | 'waiting_input' | 'skipped' | 'done' | 'failed';
export type AgentState = 'idle' | 'working' | 'done' | 'paused' | 'error';

export interface Agent {
  id: RoleId;
  name: string;
  role: string;
  description: string;
  color: string;
  position: { x: number; y: number; w: number; h: number };
  portrait: { x: number; y: number; w: number; h: number };
}

export const AGENTS: Agent[] = [
  { id: 'ceo', name: 'Prelude', role: 'CEO', description: 'Menerima brief, menyusun rencana, dan membagi pekerjaan ke tim.', color: '#D97757', position: { x: 431, y: 251, w: 89, h: 152 }, portrait: { x: 393, y: 165, w: 87, h: 103 } },
  { id: 'pm', name: 'Stanza', role: 'Product manager', description: 'Menulis spesifikasi dan kriteria selesai yang bisa diperiksa.', color: '#788C5D', position: { x: 530, y: 730, w: 104, h: 149 }, portrait: { x: 484, y: 650, w: 88, h: 100 } },
  { id: 'designer', name: 'Lyric', role: 'Designer', description: 'Menjaga design system, layout, interaksi, dan animasi yang selaras.', color: '#C46686', position: { x: 815, y: 804, w: 93, h: 173 }, portrait: { x: 766, y: 708, w: 94, h: 115 } },
  { id: 'frontend', name: 'Verse', role: 'Frontend engineer', description: 'Menerapkan desain, animasi, state, dan integrasi sesuai kontrak API.', color: '#6A9BCC', position: { x: 513, y: 517, w: 100, h: 164 }, portrait: { x: 464, y: 435, w: 97, h: 111 } },
  { id: 'backend', name: 'Prose', role: 'Backend engineer', description: 'Membangun API, validasi, aturan bisnis, dan penyimpanan data.', color: '#D4A27F', position: { x: 1080, y: 530, w: 95, h: 160 }, portrait: { x: 953, y: 548, w: 92, h: 104 } },
  { id: 'qa', name: 'Coda', role: 'QA tester', description: 'Menguji browser dari awal sampai akhir dan membuktikan kesiapan fitur.', color: '#9B8FC4', position: { x: 755, y: 453, w: 100, h: 163 }, portrait: { x: 702, y: 371, w: 106, h: 110 } },
];

export type ModelId = 'claude-sonnet-5-5' | 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface RoutingDecision { model: ModelId; effort: Effort; reason: string; }
export interface Stage { role: RoleId; status: StageStatus; summary?: string; routing?: RoutingDecision; }
export interface Log { id: string; role: RoleId | 'system'; type: 'info' | 'output' | 'file' | 'error' | 'check'; text: string; time: string; }
export interface Artifact { path: string; bytes: number; role: RoleId; }
export interface Check { name: string; passed: boolean; detail: string; }
export type EngineerRole = 'designer' | 'frontend' | 'backend';
export const ENGINEER_ROLES: EngineerRole[] = ['designer', 'frontend', 'backend'];
export interface WorkPlan { kind?: 'answer' | 'work' | 'verify' | 'operate'; lead?: EngineerRole; browser?: boolean; needsBackend: boolean; needsDesign: boolean; complexity: 'clear' | 'demanding' | 'complex'; reason: string; }
export interface TerminalCase { id: string; criterionId: string; title: string; command: string; }
export interface LocalVerification { kind: 'browser' | 'terminal' | 'live'; url?: string; serverCommand?: string; terminalTests?: TerminalCase[]; }
export interface ProjectChange { path: string; role: RoleId; }
export interface Question { id: string; question: string; options: string[]; }
export interface Clarification { id: string; role: RoleId; questions: Question[]; answers?: Record<string, string>; resume?: boolean; }
export interface Criterion { id: string; description: string; category: 'happy' | 'edge' | 'error' | 'persistence' | 'responsive' | 'motion'; }
export interface ApiContract { version: string; endpoints: { method: string; path: string; requestSchema: Record<string, unknown>; responses: { status: number; schema: Record<string, unknown> }[] }[]; }
export type BrowserAction = 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck' | 'hover' | 'focus' | 'rapidClick' | 'expectText' | 'expectExactText' | 'expectValue' | 'expectCount' | 'expectVisible' | 'expectHidden' | 'expectDisabled' | 'expectEnabled' | 'expectAttribute' | 'expectStyle' | 'expectNoOverflow' | 'expectMinSize' | 'expectRequestCount' | 'expectUrl' | 'reload' | 'goto' | 'viewport' | 'reducedMotion' | 'offline' | 'api' | 'seedData' | 'mockResponse' | 'delayResponse';
export interface BrowserStep { action: BrowserAction; selector?: string; value?: string; count?: number; width?: number; height?: number; method?: string; status?: number; body?: string; responseBody?: string; attribute?: string; property?: string; delayMs?: number; }
export interface BrowserCase { id: string; criterionId: string; title: string; steps: BrowserStep[]; }
export interface BrowserEvidence { id: string; criterionId: string; title: string; passed: boolean; detail: string; steps: { action: string; passed: boolean; detail: string }[]; screenshot?: string; }
export interface Attachment { path: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; }
export interface UserNote { text: string; time: string; }
export type Phase = 'work' | 'prepare' | 'test-plan' | 'review' | 'live';
export interface QAFinding { role: 'frontend' | 'backend' | 'designer' | 'pm' | 'qa'; summary: string; reproduction: string; expected: string; actual: string; fixInBrowser?: boolean; }
export interface UsageRecord { role: RoleId; phase: string; model: ModelId; effort: Effort; reason: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; durationMs: number; retry: number; status?: 'complete' | 'failed' | 'interrupted'; measured?: boolean; native?: boolean; chrome?: boolean; resumed?: boolean; }
export interface Task {
  id: string;
  title: string;
  prompt: string;
  mode: 'claude' | 'demo';
  status: TaskStatus;
  stages: Stage[];
  logs: Log[];
  files: Artifact[];
  checks: Check[];
  createdAt: string;
  updatedAt: string;
  workspace: string;
  access?: 'generated' | 'local';
  projectPath?: string;
  answer?: string;
  changedFiles?: ProjectChange[];
  localVerification?: LocalVerification;
  terminalEvidence?: BrowserEvidence[];
  inputTokens: number;
  outputTokens: number;
  retry: number;
  plan?: WorkPlan;
  criteria?: Criterion[];
  contract?: ApiContract;
  clarifications?: Clarification[];
  usage?: UsageRecord[];
  browserEvidence?: BrowserEvidence[];
  browserTests?: BrowserCase[];
  revisionLimit?: number;
  tokenBudget?: number;
  cacheReadExcluded?: boolean;
  attachments?: Attachment[];
  browserRoles?: RoleId[];
  nativeRoles?: RoleId[];
  notes?: UserNote[];
  previewUrl?: string;
  previewPort?: number;
  pendingFixes?: RoleId[];
  failureCounts?: Partial<Record<RoleId, number>>;
  findings?: QAFinding[];
  pauseRequested?: boolean;
  error?: string;
}
export interface EngineHealth { installed: boolean; loggedIn: boolean; provider: string; version?: string; error?: string; }
export interface Snapshot { tasks: Task[]; health: EngineHealth; workspaceRoot: string; localRoot?: string; }
export interface StageOutput { summary: string; markdown: string; files: { path: string; content: string }[]; verdict: 'pass' | 'revise' | 'none'; issues: string[]; questions: Question[]; plan?: WorkPlan; criteria?: Criterion[]; contract?: ApiContract; browserTests?: BrowserCase[]; findings?: QAFinding[]; localVerification?: LocalVerification; changedFiles?: string[]; liveEvidence?: BrowserEvidence[]; needsBrowser?: boolean; }
export const ROLE_ORDER: RoleId[] = ['ceo', 'pm', 'designer', 'backend', 'frontend', 'qa'];

export function agentState(agent: RoleId, task?: Task): AgentState {
  const stage = task?.stages.find(s => s.role === agent);
  if (!stage || task?.status === 'stopped') return 'idle';
  if (stage.status === 'working') return task?.status === 'paused' ? 'paused' : 'working';
  if (stage.status === 'failed') return 'error';
  if (stage.status === 'waiting_input') return 'paused';
  return stage.status === 'done' ? 'done' : 'idle';
}

export const STATE_LABELS: Record<AgentState, string> = { idle: 'Menunggu', working: 'Bekerja', done: 'Selesai', paused: 'Dijeda', error: 'Perlu perhatian' };
