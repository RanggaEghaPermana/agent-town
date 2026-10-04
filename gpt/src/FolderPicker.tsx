import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, FolderOpen, LoaderCircle } from 'lucide-react';
import { api } from './api';

interface DirectoryListing { path: string; parent: string; entries: { name: string; path: string }[]; truncated: boolean; }
export function FolderPicker({ initial, onSelect }: { initial: string; onSelect: (path: string) => void }) {
  const [input, setInput] = useState(initial);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  async function load(path: string) {
    const current = ++request.current; setLoading(true); setError('');
    try {
      const value = await api<DirectoryListing>(`/api/directories?path=${encodeURIComponent(path)}`);
      if (request.current === current) { setListing(value); setInput(value.path); }
    } catch (error) { if (request.current === current) setError((error as Error).message); }
    finally { if (request.current === current) setLoading(false); }
  }
  useEffect(() => { void load(initial); return () => { request.current++; }; }, [initial]);
  return <div className="folder-picker">
    <p>Folder kerja menentukan tempat agent mulai membaca dan mengerjakan project. Agent tetap dapat mengakses lokasi lain sesuai tugas lu.</p>
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); void load(input); }} className="folder-path-form">
      <input aria-label="Lokasi folder kerja" value={input} onChange={event => setInput(event.target.value)} placeholder="/home/…/project" />
      <button className="secondary-button" type="submit">Buka</button>
    </form>
    {error && <p role="alert" className="folder-error">{error}</p>}
    {loading && <p role="status"><LoaderCircle size={14} className="spin" /> Membaca folder…</p>}
    {listing && <>
      <div className="folder-location"><button type="button" className="secondary-button" disabled={loading || listing.parent === listing.path} onClick={() => void load(listing.parent)}><ArrowUp size={14} />Folder induk</button><code>{listing.path}</code></div>
      <div className="folder-list">{listing.entries.map(entry => <button type="button" key={entry.path} disabled={loading} onClick={() => void load(entry.path)}><FolderOpen size={16} /><span>{entry.name}</span></button>)}{!listing.entries.length && <p>Tidak ada subfolder.</p>}</div>
      {listing.truncated && <p>Menampilkan 500 folder pertama. Lu bisa mengetik lokasi folder lain langsung.</p>}
      <button type="button" className="secondary-button folder-use" disabled={loading || !!error} onClick={() => onSelect(listing.path)}><FolderOpen size={15} />Gunakan folder ini</button>
    </>}
  </div>;
}
