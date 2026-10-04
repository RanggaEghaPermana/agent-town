import { useState, type CSSProperties } from 'react';
import { Check, Copy, Expand, Minus, Plus } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent';
import { Modal } from './Modal';

export function ReportReader({ content }: { content: string }) {
  const [fontSize, setFontSize] = useState(() => {
    try { const saved = Number(localStorage.getItem('agent-town-gpt-reader-size-v1')); return Number.isInteger(saved) && saved >= 14 && saved <= 20 ? saved : 17; }
    catch { return 17; }
  });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  function resize(size: number) {
    setFontSize(size);
    try { localStorage.setItem('agent-town-gpt-reader-size-v1', String(size)); } catch {}
  }
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(content); setCopied(true); }
    catch { setCopied(false); setError('Teks belum bisa disalin. Lu tetap bisa memilih teks lalu menyalinnya.'); }
  }
  return <div className="report-reader" style={{ '--reader-font-size': `${fontSize}px` } as CSSProperties}>
    <div className="reader-toolbar">
      <div className="reader-size"><span>Ukuran teks</span><button className="icon-button" aria-label="Perkecil teks" disabled={fontSize <= 14} onClick={() => resize(fontSize - 1)}><Minus size={16} /></button><output aria-label="Ukuran teks saat ini">{fontSize}</output><button className="icon-button" aria-label="Perbesar teks" disabled={fontSize >= 20} onClick={() => resize(fontSize + 1)}><Plus size={16} /></button></div>
      <button className="secondary-button" aria-label="Salin teks" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}<span role="status">{copied ? 'Tersalin' : 'Salin teks'}</span></button>
    </div>
    {error && <p className="reader-error" role="alert">{error}</p>}
    <article className="reader-document" aria-label="Penjelasan lengkap"><MarkdownContent content={content} /></article>
  </div>;
}

export function ReportCard({ content, title }: { content: string; title: string }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <div className="task-answer">
      <div className="report-card-head"><strong>{title}</strong><button className="secondary-button" onClick={() => setExpanded(true)}><Expand size={14} />Baca lebar</button></div>
      <MarkdownContent content={content} />
    </div>
    {expanded && <Modal title={title} onClose={() => setExpanded(false)} wide><ReportReader content={content} /></Modal>}
  </>;
}

export function FileContent({ path, content }: { path: string; content: string }) {
  const [raw, setRaw] = useState(false);
  if (!/\.(md|markdown)$/i.test(path)) return <pre className="source-view">{content}</pre>;
  return <>
    <div className="document-view-tabs" aria-label="Tampilan dokumen">
      <button className="secondary-button" aria-pressed={!raw} onClick={() => setRaw(false)}>Tampilan baca</button>
      <button className="secondary-button" aria-pressed={raw} onClick={() => setRaw(true)}>Teks asli</button>
    </div>
    {raw ? <pre className="source-view">{content}</pre> : <ReportReader content={content} />}
  </>;
}
