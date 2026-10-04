import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { AGENTS, type RoleId } from '../shared/types';
import { OfficeWorld, type WorldProps } from './scene/OfficeWorld';

export interface OfficeHandle { zoom: (delta: number) => void; reset: () => void; rotate: (delta: number) => void; meeting: (enabled: boolean) => void; topView: () => void; }

export const Office = forwardRef<OfficeHandle, WorldProps>(function Office(value, ref) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<OfficeWorld | null>(null);
  const props = useRef(value); props.current = value;
  const labels = useRef(new Map<RoleId, HTMLButtonElement>());
  const [error, setError] = useState('');
  useImperativeHandle(ref, () => ({
    zoom: delta => world.current?.zoom(delta), reset: () => world.current?.reset(),
    rotate: delta => world.current?.rotate(delta), meeting: enabled => world.current?.setMeeting(enabled),
    topView: () => world.current?.topView(),
  }), []);
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    element.addEventListener('office-render-error', failed);
    try { world.current = new OfficeWorld(element, () => props.current, labels.current); }
    catch (error) { console.error('Office renderer:', error); setError('Kantor 3D gagal dimuat. Aktifkan akselerasi grafis browser lalu muat ulang.'); }
    return () => { element.removeEventListener('office-render-error', failed); world.current?.dispose(); world.current = null; };
  }, []);
  return <div className="office-canvas office-3d" ref={host} aria-label="Kantor 3D pixel art. Drag untuk memutar kamera, scroll untuk zoom, klik karakter untuk membuka laptop.">
    {error ? <p className="canvas-error" role="alert">{error}</p> : <>
      <div className="world-view-tag" aria-hidden="true"><span />KANTOR 3D</div>
      {AGENTS.map(agent => <button className="world-agent-label" key={agent.id} data-agent-id={agent.id} hidden ref={element => { if (element) labels.current.set(agent.id, element); else labels.current.delete(agent.id); }} onClick={() => props.current.onSelect(agent.id)} aria-label={`Pilih ${agent.name} di kantor 3D`}><strong>{agent.name}</strong><small>{agent.role}</small></button>)}
      <div className="world-controls-hint" aria-hidden="true">Drag untuk putar <span>·</span> Scroll untuk zoom</div>
    </>}
  </div>;
});
