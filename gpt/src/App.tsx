import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react';
import { ArrowUpRight, ArrowUp, Check, CheckCheck, ChevronRight, CircleHelp, Code2, Coffee, Camera, Download, Expand, ExternalLink, FileCode2, FileText, FolderOpen, History, Laptop, LoaderCircle, Maximize2, Minus, Pause, Play, Plus, Radio, RefreshCw, RotateCcw, RotateCw, Send, Settings2, Square, Users, X, Zap } from 'lucide-react';
import { AGENTS, agentState, STATE_LABELS, type Agent, type RoleId, type Task, type Snapshot, type EngineHealth } from '../shared/types';
import { api, useOffice } from './api';
import { Office, type OfficeHandle } from './Office';
import { ClarificationPanel, ContinuePanel, VerificationPanel, UsagePanel } from './TeamPanels';
import { ImageButton, ImageStrip, useImages } from './ImageInput';
import { FolderPicker } from './FolderPicker';
import { Modal } from './Modal';
import { FileContent, ReportCard } from './ReportReader';

import { Knot, Portrait } from './Portrait';
import './styles.css';

type Tab = 'laptop' | 'tasks' | 'files';
const TASK_LABELS: Record<Task['status'], string> = { queued: 'Antre', running: 'Dikerjakan', pausing: 'Menunggu jeda', paused: 'Dijeda', awaiting_input: 'Butuh jawaban', needs_attention: 'Belum terverifikasi', done: 'Siap', failed: 'Perlu perhatian', stopped: 'Dihentikan' };
const DEMO_BRIEF = 'Buat aplikasi catatan: tambah, hapus, cari berdasarkan judul, dan simpan catatan di browser.';
const formatTime = (time: string) => new Date(time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });


export default function App() {
  const { state, connected, error, setError } = useOffice();
  const [selected, setSelected] = useState<RoleId | null>(null);
  const [focusedTask, setFocusedTask] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('laptop');
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [gathering, setGathering] = useState(false);
  const [settings, setSettings] = useState(false);
  const [history, setHistory] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tokenBudget, setTokenBudget] = useState('300000');
  const [nativeRole, setNativeRole] = useState(() => { try { return localStorage.getItem('agent-town-gpt-native-role-v1') || ''; } catch { return ''; } });
  const [access, setAccess] = useState<'local' | 'generated'>('local');
  const [projectPath, setProjectPath] = useState(() => { try { return localStorage.getItem('agent-town-gpt-project-path-v1') || ''; } catch { return ''; } });
  const [pickFolder, setPickFolder] = useState(false);
  const [file, setFile] = useState<{ path: string; content: string; id: string; project?: boolean } | null>(null);
  const [preview, setPreview] = useState<{ url: string; id: string } | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const fileRequest = useRef(0);
  const office = useRef<OfficeHandle>(null);
  const task = state.tasks.find(t => t.id === focusedTask) || state.tasks.find(t => ['running', 'pausing', 'paused', 'awaiting_input'].includes(t.status)) || state.tasks[0];
  const active = task && ['running', 'pausing', 'paused', 'awaiting_input'].includes(task.status);
  const currentRole = task?.stages.find(s => s.status === 'working')?.role;
  const agent = AGENTS.find(a => a.id === selected) || AGENTS[0];
  const busyCount = state.tasks.filter(t => ['running', 'pausing'].includes(t.status)).length;
  const totalTokens = state.tasks.reduce((n, t) => n + t.inputTokens + t.outputTokens, 0);

  useEffect(() => {
    if (!focusMode) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocusMode(false); };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [focusMode]);
  useEffect(() => { office.current?.meeting(gathering); }, [gathering]);
  useEffect(() => { try { localStorage.setItem('agent-town-gpt-project-path-v1', projectPath); } catch {} }, [projectPath]);
  useEffect(() => { try { localStorage.setItem('agent-town-gpt-native-role-v1', nativeRole); } catch {} }, [nativeRole]);
  useEffect(() => { fileRequest.current++; }, [task?.id]);
  const briefImages = useImages(setError);
  function select(id: RoleId) { setSelected(id); setTab('laptop'); setFocusMode(false); }
  async function create(mode: 'gpt' | 'demo') {
    if (sending) return;
    const brief = mode === 'demo' ? DEMO_BRIEF : prompt.trim();
    if (brief.length < 5) { setError('Tulis tugas yang ingin lu kasih ke tim dulu.'); return; }
    setSending(true); setError('');
    try {
      const budget = Number(tokenBudget);
      if (!Number.isInteger(budget) || budget < 10000 || budget > 1000000) throw new Error('Batas token harus 10.000–1.000.000.');
      const value = await api<Task>('/api/tasks', { prompt: brief, mode, tokenBudget: budget, access: mode === 'demo' ? 'generated' : access, ...(mode === 'gpt' && access === 'local' ? { projectPath: projectPath || state.localRoot } : {}), ...(mode === 'gpt' && briefImages.images.length ? { images: briefImages.images } : {}), ...(mode === 'gpt' && access === 'local' && nativeRole ? { nativeRoles: [nativeRole] } : {}) });
      setFocusedTask(value.id); setSelected('ceo'); setTab('tasks');
      if (mode === 'gpt') { setPrompt(''); briefImages.clear(); }
    } catch (error) { setError((error as Error).message); }
    finally { setSending(false); }
  }
  async function control(action: 'pause' | 'resume' | 'stop' | 'continue', body: { note?: string; images?: string[] } = {}) {
    if (!task) return false;
    try { await api(`/api/tasks/${task.id}/${action}`, body); return true; } catch (error) { setError((error as Error).message); return false; }
  }
  async function openFile(path: string, project = false) {
    if (!task) return;
    const request = ++fileRequest.current;
    if (!project && path.endsWith('.png')) { setEvidence(`/gpt/api/tasks/${task.id}/evidence?path=${encodeURIComponent(path)}`); return; }
    try {
      const value = await api<{ path: string; content: string }>(`/api/tasks/${task.id}/${project ? 'project-file' : 'file'}?path=${encodeURIComponent(path)}`);
      if (request === fileRequest.current) setFile({ ...value, id: task.id, project });
    } catch (error) {
      if (request === fileRequest.current) setError((error as Error).message);
    }
  }
  function closeFile() { fileRequest.current++; setFile(null); }
  async function openPreview() {
    if (!task || previewLoading) return;
    setPreviewLoading(true);
    try { const value = await api<{ url: string }>(`/api/tasks/${task.id}/preview`); setPreview({ url: value.url, id: task.id }); } catch (error) { setError((error as Error).message); }
    finally { setPreviewLoading(false); }
  }
  async function checkHealth() {
    setChecking(true);
    try { await api<EngineHealth>('/api/health', {}); } catch (error) { setError((error as Error).message); }
    finally { setChecking(false); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Agent Town, kantor utama"><span className="brand-mark"><Knot size={25} /></span><span>agent<span className="brand-second">town</span><small>CHATGPT / OPENAI OFFICE</small></span></a>
      <div className="header-divider" /><span className="workspace-name"><span className="tiny-square" /> Kantor GPT <ChevronRight size={14} /><span className="local-badge">LOCAL</span></span>
      <div className="header-right"><span className={`connection ${connected ? '' : 'offline'}`}><i />{connected ? 'Kantor terhubung' : 'Menghubungkan…'}</span><button className="header-button" aria-label={`Riwayat ${state.tasks.length}`} title="Riwayat project" onClick={() => setHistory(true)}><History size={17} /><span>Riwayat</span>{state.tasks.length > 0 && <b>{state.tasks.length}</b>}</button><button className="icon-button" aria-label="Pengaturan koneksi" onClick={() => setSettings(true)}><Settings2 size={19} /></button><span className="owner-avatar">R</span></div>
    </header>

    <main className="main-layout">
      <section className="workspace" aria-label="Kantor dan tim">
        <div className="office-heading"><div><span className="eyebrow">WORKSPACE / 01</span><h1>Apa yang bisa dibantu?</h1></div><div className="office-summary"><Coffee size={16} /><span>{busyCount ? 'Tim lagi bekerja' : 'Tim siap menerima tugas'}</span></div></div>
        <div className={`scene-frame ${focusMode ? 'focus-mode' : ''}`}>
          <div className="scene-toolbar"><div className="scene-title"><span className="live-dot" /><span>Kantor GPT</span><span className="scene-sub">3D isometrik</span>{task?.mode === 'demo' && active && <span className="mode-pill">DEMO</span>}</div><div className="scene-actions"><button className={`icon-button names-toggle ${showNames ? 'pressed' : ''}`} aria-label="Tampilkan nama karakter" aria-pressed={showNames} title="Tampilkan nama karakter" onClick={() => setShowNames(v => !v)}><Users size={16} /></button><button className={`icon-button meeting-toggle ${gathering ? "pressed" : ""}`} aria-label={gathering ? "Kembali ke meja" : "Kumpulkan tim di meeting"} aria-pressed={gathering} title="Gerakan meeting tanpa memakai token AI" onClick={() => setGathering(v => !v)}><Coffee size={16} /></button><span className="toolbar-separator" /><button className="icon-button" aria-label="Kamera dari atas" title="Lihat denah dari atas" onClick={() => office.current?.topView()}><Camera size={16} /></button><button className="icon-button" aria-label="Putar kamera ke kiri" title="Putar kamera ke kiri" onClick={() => office.current?.rotate(-Math.PI / 6)}><RotateCcw size={16} /></button><button className="icon-button" aria-label="Putar kamera ke kanan" title="Putar kamera ke kanan" onClick={() => office.current?.rotate(Math.PI / 6)}><RotateCw size={16} /></button><button className="icon-button" aria-label="Zoom keluar" onClick={() => office.current?.zoom(-0.25)}><Minus size={16} /></button><button className="icon-button" aria-label="Zoom masuk" onClick={() => office.current?.zoom(0.25)}><Plus size={16} /></button><button className="icon-button" aria-label="Reset kamera" title="Tampilkan seluruh kantor" onClick={() => office.current?.reset()}><Maximize2 size={16} /></button><button className="icon-button" aria-label={focusMode ? 'Keluar dari layar penuh' : 'Kantor layar penuh'} title="Kantor layar penuh · Esc untuk kembali" onClick={() => setFocusMode(value => !value)}><Expand size={15} /></button></div></div>
          <Office ref={office} selected={selected} task={task} showNames={showNames} onSelect={select} onBoard={() => { setTab('tasks'); setFocusMode(false); }} />
          <div className="scene-caption"><span><span className="mouse-pixel" /> Klik karakter untuk membuka laptop</span><span className="camera-note">Drag untuk putar · klik kanan untuk geser</span></div>
        </div>

        <div className="team-heading"><span>TIM KANTOR <b>06</b></span><span>{currentRole ? `${AGENTS.find(a => a.id === currentRole)?.name} sedang bekerja` : 'Satu tim, satu alur kerja'}</span></div>
        <div className="agent-dock">{AGENTS.map(a => {
          const status = agentState(a.id, task);
          return <button key={a.id} className={`agent-card ${selected === a.id ? 'selected' : ''} ${status === 'working' ? 'working' : ''}`} style={{ '--agent-color': a.color } as CSSProperties} onClick={() => select(a.id)} aria-pressed={selected === a.id} aria-label={`Buka laptop ${a.name}, ${a.role}`}>
            <Portrait agent={a} size={42} /><span className="agent-card-text"><strong>{a.name}</strong><span>{a.role}</span><small className={`agent-status ${status}`}><i />{STATE_LABELS[status]}</small></span>{status === 'working' && <span className="typing-dots"><i /><i /><i /></span>}
          </button>;
        })}</div>

        <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); void create('gpt'); }}>
          <div className="composer-label"><span><Send size={15} /> KASIH TUGAS KE TIM</span><span>CEO akan membaginya ke agent yang tepat</span></div>
          <div className="project-context">
            <select aria-label="Cara menjalankan tugas" value={access} onChange={event => setAccess(event.target.value as 'local' | 'generated')}><option value="local">Akses laptop</option><option value="generated">Project baru sederhana</option></select>
            {access === 'local' && <><button type="button" className="project-folder" onClick={() => setPickFolder(true)}><FolderOpen size={14} /><span>{projectPath || state.localRoot || 'Pilih folder kerja'}</span></button><small>Baca · edit · terminal</small></>}
          </div>
          <textarea aria-label="Tugas untuk CEO" placeholder="Atlas, bikinin aplikasi catatan dengan pencarian dan tombol hapus…" value={prompt} maxLength={6000} rows={2} onChange={event => setPrompt(event.target.value)} onPaste={briefImages.onPaste} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void create('gpt'); } }} />
          <ImageStrip input={briefImages} />
          <div className="composer-bottom"><div className="engine-label"><span className={state.health.loggedIn ? 'live-dot' : 'dot-amber'} />{state.health.loggedIn ? 'GPT terhubung' : 'GPT belum siap'}<span className="composer-type">Frontend + backend lokal</span></div><ImageButton input={briefImages} disabled={sending} /><button className="composer-demo" type="button" disabled={sending || !connected} onClick={() => void create('demo')}>Coba demo · 0 token</button><button className="send-button" type="submit" disabled={!connected || !state.health.loggedIn || sending || prompt.trim().length < 5}>{sending ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}<span>Kirim tugas</span></button></div>
        </form>
        <footer className="workspace-footer"><span><span className="live-dot" /> Berjalan di laptop lu</span><span>File tersimpan lokal · {totalTokens > 0 ? `${totalTokens.toLocaleString('id-ID')} token tercatat` : 'Belum memakai token'}</span></footer>
      </section>

      <aside className="right-panel">
        <nav className="panel-tabs" aria-label="Panel kantor">{([{ id: 'laptop', label: 'Laptop', icon: Laptop }, { id: 'tasks', label: 'Tugas', icon: CheckCheck }, { id: 'files', label: 'File', icon: FolderOpen }] as const).map(item => <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}><item.icon size={16} />{item.label}{item.id === 'files' && !!task?.files.length && <span>{task.files.length}</span>}</button>)}</nav>
        <div className="panel-scroll">
          {task?.status === 'awaiting_input' && <ClarificationPanel key={task.clarifications?.at(-1)?.id} task={task} onError={setError} />}
          {tab === 'laptop' && <LaptopPanel agent={agent} task={task} onDemo={() => void create('demo')} sending={sending} />}
          {tab === 'tasks' && <TaskPanel task={task} tasks={state.tasks} onSelect={id => setFocusedTask(id)} onAgent={select} onContinue={(note, images) => control('continue', { ...(note ? { note } : {}), ...(images.length ? { images } : {}) })} onError={setError} />}
          {tab === 'files' && <FilesPanel task={task} onFile={path => void openFile(path)} onProjectFile={path => void openFile(path, true)} onPreview={() => void openPreview()} previewLoading={previewLoading} />}
        </div>
        {active && <div className="run-controls"><span><Radio size={14} />{TASK_LABELS[task.status]}</span>{task.status !== 'awaiting_input' && <button className="icon-button" aria-label={['paused', 'pausing'].includes(task.status) ? 'Lanjutkan tugas' : 'Jeda setelah tahap aktif'} title={['paused', 'pausing'].includes(task.status) ? 'Lanjutkan' : 'Jeda setelah tahap aktif'} onClick={() => void control(['paused', 'pausing'].includes(task.status) ? 'resume' : 'pause')}>{['paused', 'pausing'].includes(task.status) ? <Play size={16} /> : <Pause size={16} />}</button>}<button className="icon-button stop-button" aria-label="Hentikan tugas" title="Hentikan tugas" onClick={() => void control('stop')}><Square size={14} /></button></div>}
        <div className="panel-footer"><span>Maksimalkan hasil · Minimalkan usage</span><CircleHelp size={14} /></div>
      </aside>
    </main>

    {error && <div role="alert" className="toast"><span>{error}</span><button className="icon-button" aria-label="Tutup pesan" onClick={() => setError('')}><X size={17} /></button></div>}
    {pickFolder && <Modal title="Pilih folder kerja" onClose={() => setPickFolder(false)}><FolderPicker initial={projectPath || state.localRoot || ''} onSelect={path => { setProjectPath(path); setPickFolder(false); }} /></Modal>}
    {settings && <Modal title="Koneksi kantor" onClose={() => setSettings(false)}>
      <div className="settings-content"><div className="connection-card"><span className="engine-icon"><Code2 size={26} /></span><div><h3>Codex</h3><p>{state.health.loggedIn ? 'Login aktif di laptop ini' : 'Belum login atau tidak tersedia'}</p></div><span className={state.health.loggedIn ? 'health-good' : 'health-bad'}>{state.health.loggedIn ? 'Terhubung' : 'Belum siap'}</span></div><p>{state.health.version || state.health.error || 'Memeriksa engine…'}</p><button className="secondary-button" onClick={() => void checkHealth()} disabled={checking}><RefreshCw size={15} className={checking ? 'spin' : ''} />Periksa koneksi lagi</button>{!state.health.loggedIn && <p>Login lewat terminal: <code>codex login</code></p>}<div className="settings-detail"><strong>Folder hasil kerja</strong><code>{state.workspaceRoot || 'Memuat…'}</code><p>Laporan tiap tugas disimpan di folder terpisah. Dalam mode Akses laptop, agent membaca dan mengedit file asli serta menjalankan terminal dengan hak akun Linux lu. Pilih folder kerja di kotak tugas.</p></div><div className="settings-detail"><label htmlFor="project-token-budget"><strong>Batas token project baru</strong></label><input id="project-token-budget" className="budget-input" type="number" min={10000} max={1000000} step={10000} value={tokenBudget} onChange={event => setTokenBudget(event.target.value)} /><p>Tim berhenti sebelum panggilan berikutnya jika token tercatat mencapai batas. Cache yang dibaca ulang tidak dihitung. Panggilan aktif dapat melewati batas; angka ini tidak sama dengan kuota langganan.</p></div><div className="settings-detail"><label htmlFor="native-role"><strong>Uji cara kerja bawaan Codex</strong></label><select id="native-role" className="budget-input" value={nativeRole} onChange={event => setNativeRole(event.target.value)}><option value="">Tidak ada (hemat)</option>{AGENTS.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select><p>Untuk tugas baru di mode Akses laptop, agent terpilih memakai cara kerja bawaan Codex ditambah aturan kantor. Jalankan tugas yang sama dengan dan tanpa pilihan ini, lalu bandingkan dengan <code>npm run usage:gpt</code>.</p></div><div className="settings-detail"><strong>Pemakaian</strong><p>{totalTokens.toLocaleString('id-ID')} token tercatat dari tugas di kantor ini. Sisa limit langganan tidak tersedia dari integrasi ini. Demo memakai 0 token.</p></div></div>
    </Modal>}
    {history && <Modal title="Riwayat project" onClose={() => setHistory(false)}>
      <div className="history-list">{state.tasks.length ? state.tasks.map(t => <button key={t.id} onClick={() => { setFocusedTask(t.id); setTab('tasks'); setHistory(false); }}><span className={`task-dot ${t.status}`} /><span><strong>{t.title}</strong><small>{new Date(t.createdAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' })} · {TASK_LABELS[t.status]} · {t.files.length} file</small></span><ChevronRight size={17} /></button>) : <div className="empty-block"><History size={30} /><h3>Belum ada project</h3><p>Kirim tugas pertama atau coba demo. Riwayatnya akan tersimpan di sini.</p></div>}</div>
    </Modal>}
    {file && <Modal title={file.path} onClose={closeFile} wide><div className="file-modal-toolbar"><span>{file.project ? 'File project laptop' : 'Hasil kerja tim'}</span><a className="secondary-button" href={`/gpt/api/tasks/${file.id}/${file.project ? 'project-download' : 'download'}?path=${encodeURIComponent(file.path)}`} download><Download size={15} />Unduh file</a></div><FileContent key={file.id + file.path} path={file.path} content={file.content} /></Modal>}
    {evidence && <Modal title="Bukti browser QA" onClose={() => setEvidence(null)} wide><img className="evidence-image" src={evidence} alt="Screenshot hasil pengujian browser QA" /></Modal>}
    {preview && <Modal title="Preview hasil project" onClose={() => { setPreview(null); void api(`/api/tasks/${preview.id}/close-preview`, {}).catch(error => setError(error.message)); }} wide><p className="preview-notice">{state.tasks.find(item => item.id === preview.id)?.access === 'local' ? 'Preview menjalankan project asli. Data mengikuti konfigurasi aplikasi tersebut dan dapat dipakai bersama pengujian QA.' : 'Project berjalan pada origin lokal terpisah. Data preview terpisah dari data pengujian QA.'}</p><iframe title="Hasil web dari tim agent" src={preview.url} sandbox="allow-scripts allow-forms allow-same-origin" className="project-preview" /></Modal>}
  </div>;
}

function LaptopPanel({ agent, task, onDemo, sending }: { agent: Agent; task?: Task; onDemo: () => void; sending: boolean }) {
  const state = agentState(agent.id, task);
  const logs = task?.logs.filter(l => l.role === agent.id || l.role === 'system') || [];
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => { if (screen.current) screen.current.scrollTop = screen.current.scrollHeight; }, [agent.id, task?.id, logs.length]);
  return <>
    <div className="inspector-identity"><Portrait agent={agent} size={62} /><div><span className="eyebrow">LAPTOP AGENT</span><h2>{agent.name}<span className={`identity-status ${state}`} /></h2><span className="role-tag">{agent.role}</span></div></div>
    <p className="agent-description">{agent.description}</p>
    <UsagePanel task={task} role={agent.id} />
    <div className="terminal"><div className="terminal-bar"><span><i /><i /><i /></span><span>{agent.name.toLowerCase()} / activity</span><span><Radio size={12} /></span></div><div className="terminal-screen" ref={screen} aria-label={`Aktivitas ${agent.name}`}>
      <div className="terminal-greeting"><span className="terminal-prompt">›</span> Laptop {agent.name}<br /><span className="terminal-dim">{agent.role} · {STATE_LABELS[state]}</span></div>
      {logs.length ? logs.map(log => <div key={log.id} className={`terminal-line ${log.type}`}><span className="log-time">{formatTime(log.time)}</span><pre>{log.text}</pre></div>) : <><div className="terminal-empty"><span className="terminal-prompt">$</span> menunggu brief baru<span className="terminal-cursor" /></div><p className="terminal-dim">Aktivitas dan hasil kerja akan muncul di sini ketika tim mulai bekerja.</p></>}
      {state === 'working' && <div className="terminal-working"><span className="typing-dots"><i /><i /><i /></span> {task?.mode === 'demo' ? 'Demo berjalan…' : 'Menunggu output GPT…'}</div>}
    </div><div className="terminal-foot"><span><i className={state === 'working' ? 'busy-indicator' : ''} />{task?.mode === 'demo' ? 'Demo · tanpa AI' : 'Aktivitas & output'}</span><span>{logs.length} event</span></div></div>
    {!task && <div className="welcome-note"><span className="welcome-icon"><Zap size={20} /></span><h3>Kenalan sama tim dulu?</h3><p>Coba satu alur demo. Lihat tim membagi tugas dan menghasilkan aplikasi catatan, tanpa memakai kuota.</p><button className="secondary-button demo-button" onClick={onDemo} disabled={sending}><Play size={15} />Coba demo kantor<ArrowUpRight size={15} /></button><small>Contoh alur · 0 token · sekitar 15 detik</small></div>}
    {task && <div className="inspector-task"><span className="eyebrow">PROJECT AKTIF</span><h3>{task.title}</h3><span className={`task-status-pill ${task.status}`}>{TASK_LABELS[task.status]}</span>{task.mode === 'demo' && <span className="demo-label">Contoh alur tanpa koneksi AI</span>}</div>}
  </>;
}

function TaskPanel({ task, tasks, onSelect, onAgent, onContinue, onError }: { task?: Task; tasks: Task[]; onSelect: (id: string) => void; onAgent: (id: RoleId) => void; onContinue: (note: string, images: string[]) => Promise<boolean>; onError: (message: string) => void }) {
  if (!task) return <div className="empty-block"><CheckCheck size={35} /><h3>Papan tugas masih kosong</h3><p>Tulis brief di bawah kantor. Atlas akan menyusun rencana dan membaginya ke tim.</p><div className="empty-workflow">CEO <ChevronRight size={13} /> PM <ChevronRight size={13} /> Design <ChevronRight size={13} /> Code <ChevronRight size={13} /> QA</div></div>;
  const done = task.stages.filter(s => ['done', 'skipped'].includes(s.status)).length;
  const total = task.stages.length;
  return <div className="task-panel-content"><div className="panel-section-title"><span className="eyebrow">PAPAN TUGAS</span><span className={`task-status-pill ${task.status}`}>{TASK_LABELS[task.status]}</span></div><h2 className="task-title">{task.title}</h2><p className="task-brief">{task.prompt}</p>{task.mode === 'demo' && <div className="demo-banner"><Zap size={15} />Mode demo · tidak memanggil AI</div>}{task.projectPath && <div className="task-project"><strong>Folder kerja</strong><code>{task.projectPath}</code><small>Akses laptop · baca, edit, terminal</small></div>}{task.answer && <ReportCard key={task.id} title={task.plan?.kind === 'verify' || task.plan?.kind === 'operate' ? 'Laporan Echo' : 'Jawaban Atlas'} content={task.answer} />}<div className="budget-caption">{(task.inputTokens + task.outputTokens).toLocaleString('id-ID')} / {(task.tokenBudget || 120000).toLocaleString('id-ID')} token tercatat</div><div className="progress-caption"><span>Progres tim</span><strong>{done} / {total} tahap</strong></div><div className="progress-track"><span style={{ width: `${done / total * 100}%` }} /></div><div className="stages">{task.stages.map((stage, i) => {
    const agent = AGENTS.find(a => a.id === stage.role)!;
    return <button className={`stage-row ${stage.status}`} key={stage.role} onClick={() => onAgent(stage.role)}><span className="stage-number">{stage.status === 'done' ? <Check size={14} /> : stage.status === 'working' ? <LoaderCircle size={14} className="spin" /> : i + 1}</span><div><strong>{agent.name}<small>{agent.role}</small></strong>{stage.routing && <small className="routing-caption">{task.mode === 'demo' ? 'Demo · 0 token' : `${stage.routing.model.replace(/^claude-/, '')} · ${stage.routing.effort}`}</small>}<p>{stage.summary || (stage.status === 'working' ? 'Sedang mengerjakan…' : stage.status === 'waiting_input' ? 'Menunggu jawaban lu' : 'Menunggu giliran')}</p></div><ChevronRight size={14} /></button>;
  })}</div>{task.error && <div className="task-error">{task.error}</div>}<VerificationPanel task={task} />{['needs_attention', 'failed', 'stopped'].includes(task.status) && <ContinuePanel key={`continue-${task.id}`} onContinue={onContinue} onError={onError} />}{task.checks.length > 0 && <div className="checks-list">{task.checks.map((check, i) => <div key={i}><span className={check.passed ? 'check-pass' : 'check-fail'}>{check.passed ? '✓' : '×'}</span>{check.name}</div>)}</div>}<div className="board-counts">{[{ label: 'Antre', count: tasks.filter(t => t.status === 'queued').length }, { label: 'Aktif', count: tasks.filter(t => ['running','paused','pausing','awaiting_input'].includes(t.status)).length }, { label: 'Selesai', count: tasks.filter(t => t.status === 'done').length }].map(item => <div key={item.label}><strong>{item.count}</strong><span>{item.label}</span></div>)}</div>{tasks.filter(t => t.status === 'queued' && t.id !== task.id).map(t => <button className="queue-item" key={t.id} onClick={() => onSelect(t.id)}><span>Antre</span>{t.title}<ChevronRight size={14} /></button>)}</div>;
}

function FilesPanel({ task, onFile, onProjectFile, onPreview, previewLoading }: { task?: Task; onFile: (path: string) => void; onProjectFile: (path: string) => void; onPreview: () => void; previewLoading: boolean }) {
  if (!task?.files.length) return <div className="empty-block"><FolderOpen size={35} /><h3>Hasil kerja tim</h3><p>Rencana, spesifikasi, desain, kode, dan laporan QA muncul di sini setelah dibuat.</p></div>;
  const local = task.access === 'local';
  const hasPreview = local ? task.localVerification?.kind === 'browser' : task.files.some(file => file.path === 'index.html');
  return <div className="files-panel-content">
    <span className="eyebrow">HASIL PROJECT</span><h2>{task.title}</h2>
    {local && <div className="task-project"><strong>Folder kerja</strong><code>{task.projectPath}</code></div>}
    {!!task.changedFiles?.length && <><span className="eyebrow">FILE PROJECT YANG BERUBAH</span><div className="file-list">{task.changedFiles.map(file => <button key={file.path} onClick={() => onProjectFile(file.path)}><FileCode2 size={18} /><div><strong>{file.path}</strong><small>{AGENTS.find(agent => agent.id === file.role)?.name}</small></div><ArrowUpRight size={15} /></button>)}</div></>}
    <div className="file-folder"><FolderOpen size={17} /><span>{local ? 'Laporan tim' : task.id.slice(0, 8) + ' /'}</span><span>{task.files.length} file</span></div>
    <div className="file-list">{task.files.map(file => <button key={file.path} onClick={() => onFile(file.path)}>{/\.(html|css|js)$/.test(file.path) ? <FileCode2 size={18} /> : <FileText size={18} />}<div><strong>{file.path}</strong><small>{AGENTS.find(agent => agent.id === file.role)?.name} · {(file.bytes / 1024).toFixed(1)} KB</small></div><ArrowUpRight size={15} /></button>)}</div>
    {hasPreview && <button className="preview-button" onClick={onPreview} disabled={previewLoading}>{previewLoading ? <LoaderCircle size={16} className="spin" /> : <ExternalLink size={16} />}Buka preview hasil</button>}
    <div className="local-folder"><span>{local ? 'LAPORAN TERSIMPAN DI LAPTOP' : 'TERSIMPAN DI LAPTOP'}</span><code>{task.workspace}</code></div>
  </div>;
}
