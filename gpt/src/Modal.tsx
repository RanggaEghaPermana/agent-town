import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-head"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Tutup dialog" onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}
