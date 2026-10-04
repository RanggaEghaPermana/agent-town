import { useRef, useState, type ClipboardEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const read = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Gambar tidak bisa dibaca.'));
  reader.readAsDataURL(file);
});

export function useImages(onError: (message: string) => void) {
  const [images, setImages] = useState<string[]>([]);
  async function add(files: File[]) {
    if (!files.length) return;
    try {
      if (files.some(file => !TYPES.includes(file.type))) throw new Error('Gambar harus PNG, JPEG atau WebP.');
      if (files.some(file => file.size > 5_000_000)) throw new Error('Ukuran tiap gambar maksimal 5 MB.');
      const added = await Promise.all(files.map(read));
      setImages(current => { if (current.length + added.length > 6) { onError('Lampirkan maksimal 6 gambar per kiriman.'); return current; } return [...current, ...added]; });
    } catch (error) { onError((error as Error).message); }
  }
  // Text pastes keep their default behaviour; only clipboard images are captured.
  function onPaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); void add(files); }
  }
  return { images, add, onPaste, remove: (index: number) => setImages(current => current.filter((_, i) => i !== index)), clear: () => setImages([]) };
}

export function ImageButton({ input, disabled }: { input: ReturnType<typeof useImages>; disabled?: boolean }) {
  const picker = useRef<HTMLInputElement>(null);
  return <>
    <input ref={picker} type="file" accept={TYPES.join(',')} multiple hidden onChange={event => { void input.add([...(event.target.files || [])]); event.target.value = ''; }} />
    <button type="button" className="image-button" disabled={disabled} title="Pilih gambar dari file, atau tempel screenshot (Ctrl+V) di kotak teks" onClick={() => picker.current?.click()}><ImagePlus size={14} />Gambar</button>
  </>;
}

export function ImageStrip({ input }: { input: ReturnType<typeof useImages> }) {
  if (!input.images.length) return null;
  return <div className="image-strip">{input.images.map((image, index) => <span key={index}><img src={image} alt={`Lampiran ${index + 1}`} /><button type="button" aria-label={`Hapus lampiran ${index + 1}`} onClick={() => input.remove(index)}><X size={11} /></button></span>)}</div>;
}
