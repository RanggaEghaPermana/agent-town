import { useState, type FormEvent } from 'react';
import { CheckCheck, LoaderCircle, Play, Send } from 'lucide-react';
import type { RoleId, Task } from '../shared/types';
import { api } from './api';
import { ImageButton, ImageStrip, useImages } from './ImageInput';

export function ClarificationPanel({ task, onError }: { task: Task; onError: (message: string) => void }) {
  const clarification = task.clarifications?.find(item => !item.answers);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const images = useImages(onError);
  if (!clarification) return null;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!clarification || sending) return; setSending(true);
    try { await api(`/api/tasks/${task.id}/answer`, { clarificationId: clarification.id, answers, ...(images.images.length ? { images: images.images } : {}) }); images.clear(); }
    catch (error) { onError((error as Error).message); }
    finally { setSending(false); }
  }
  return <form className="clarification-card" onSubmit={event => void submit(event)}>
    <span className="eyebrow">PERLU KEPUTUSAN LU</span><h3>Biar tim tidak menebak.</h3><p>Bagian ini menunggu jawaban. Tugas lain dalam antrean tetap bisa berjalan.</p>
    {clarification.questions.map(question => <fieldset key={question.id}>
      <legend>{question.question}</legend>
      {question.options.length > 0 && <div className="answer-options">{question.options.map(option => <button key={option} type="button" aria-pressed={answers[question.id] === option} onClick={() => setAnswers(current => ({ ...current, [question.id]: option }))}>{option}</button>)}</div>}
      <textarea aria-label={question.question} required maxLength={3000} rows={2} value={answers[question.id] || ''} onPaste={images.onPaste} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} />
    </fieldset>)}
    <ImageStrip input={images} />
    <ImageButton input={images} disabled={sending} />
    <button className="secondary-button" type="submit" disabled={sending || clarification.questions.some(question => !answers[question.id]?.trim())}>{sending ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}Kirim jawaban & lanjutkan</button>
  </form>;
}

export function UsagePanel({ task, role }: { task?: Task; role: RoleId }) {
  const stage = task?.stages.find(item => item.role === role);
  if (!stage?.routing) return null;
  const usage = task?.usage?.filter(item => item.role === role) || [];
  return <div className="agent-routing"><strong>{task?.mode === 'demo' ? 'Demo · tanpa AI' : `${stage.routing.model.replace('claude-', '')} · ${stage.routing.effort}`}</strong><p>{stage.routing.reason}</p><small>{usage.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0).toLocaleString('id-ID')} token · {usage.length} panggilan · cache dibaca {usage.reduce((sum, item) => sum + item.cacheReadTokens, 0).toLocaleString('id-ID')}</small>{usage.some(item => item.measured === false) && <small className="unmetered-note">{usage.filter(item => item.measured === false).length} panggilan gagal/dihentikan: token tidak tersedia.</small>}</div>;
}

export function VerificationPanel({ task }: { task: Task }) {
  if (task.plan?.kind === 'answer') return null;
  const terminal = task.localVerification?.kind === 'terminal';
  const evidence = (terminal ? task.terminalEvidence : task.browserEvidence) || [];
  return <div className="verification-panel"><div className="qa-note"><CheckCheck size={17} /><p>{evidence.length ? `${evidence.filter(item => item.passed).length}/${evidence.length} skenario ${terminal ? 'terminal' : 'browser'} lulus. Semua kriteria dan review QA wajib lulus sebelum siap.` : 'Belum ada bukti pengujian. Hasil belum dinyatakan siap.'}</p></div>
    {evidence.map(item => <details key={item.id} className={`evidence-case ${item.passed ? 'passed' : 'failed'}`}><summary>{item.passed ? '✓' : '×'} {item.title}</summary><p>{item.detail}</p><ol>{item.steps.map((step, index) => <li key={index}>{step.passed ? '✓' : '×'} {step.action}: {step.detail}</li>)}</ol>{item.screenshot && <a href={`/api/tasks/${task.id}/evidence?path=${encodeURIComponent(item.screenshot)}`} target="_blank" rel="noreferrer">Lihat bukti browser ↗</a>}</details>)}
  </div>;
}

export function ContinuePanel({ onContinue, onError }: { onContinue: (note: string, images: string[]) => Promise<boolean>; onError: (message: string) => void }) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const images = useImages(onError);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (sending) return; setSending(true);
    try { if (await onContinue(note.trim(), images.images)) { setNote(''); images.clear(); } }
    finally { setSending(false); }
  }
  return <form className="continue-panel" onSubmit={event => void submit(event)}>
    <textarea aria-label="Pesan untuk tim" placeholder="Pesan untuk tim (opsional): arahan, URL yang benar, atau tempel screenshot…" maxLength={3000} rows={2} value={note} onPaste={images.onPaste} onChange={event => setNote(event.target.value)} />
    <ImageStrip input={images} />
    <div><ImageButton input={images} disabled={sending} /><button className="secondary-button" type="submit" disabled={sending}>{sending ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}Lanjutkan diagnosis</button></div>
  </form>;
}
