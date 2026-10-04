import type { CSSProperties } from 'react';
import type { Agent } from '../shared/types';
import { APPEARANCES } from './scene/character';

// A soft illustrated avatar on a tinted blob, drawn from the same appearance the 3D character wears.
export function Portrait({ agent, size = 44 }: { agent: Agent; size?: number }) {
  const look = APPEARANCES[agent.id], ink = '#141413';
  return <svg className="portrait" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ '--agent-color': agent.color } as CSSProperties}>
    <path d="M24 1.5c10 0 22 4.5 22 21.5S37 46.5 24 46.5 1.5 39 2.5 23 13 1.5 24 1.5z" fill={agent.color} opacity=".24" />
    <path d="M7.5 48c0-9.5 7-14.5 16.5-14.5S40.5 38.5 40.5 48z" fill={look.shirt} />
    <rect x="20.5" y="28" width="7" height="8" rx="3" fill={look.skin} />
    {look.longHair && <path d="M12.5 22c0-9 5-14 11.5-14s11.5 5 11.5 14v11.5c0 2.2-3.2 2.2-3.2 0V24H15.7v9.5c0 2.2-3.2 2.2-3.2 0z" fill={look.hair} />}
    <ellipse cx="24" cy="22.5" rx="9.3" ry="10.2" fill={look.skin} />
    <path d="M14.2 21c-.6-8 4.3-13 9.8-13s10.4 5 9.8 13c-2.6-4.2-5.6-6-9.8-6s-7.2 1.8-9.8 6z" fill={look.hair} />
    {look.beard && <path d="M15.4 24.5c.8 7.6 4.8 9.3 8.6 9.3s7.8-1.7 8.6-9.3c-2 3-5 4-8.6 4s-6.6-1-8.6-4z" fill={look.hair} />}
    <circle cx="20.3" cy="22.8" r="1.2" fill={ink} /><circle cx="27.7" cy="22.8" r="1.2" fill={ink} />
    {!look.beard && <path d="M21.2 27.3c1.7 1.4 3.9 1.4 5.6 0" fill="none" stroke={ink} strokeWidth="1.1" strokeLinecap="round" opacity=".65" />}
    {look.glasses && <g fill="none" stroke={ink} strokeWidth="1.05"><circle cx="20.3" cy="22.8" r="3.3" /><circle cx="27.7" cy="22.8" r="3.3" /><path d="M23.6 22.5h.800" /></g>}
  </svg>;
}

// The office mark: a hand-drawn burst in clay.
export function Spark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
    {[0, 30, 60, 90, 120, 150].map((angle, i) => <line key={angle} x1="12" y1={2.2 + (i % 3) * 0.9} x2="12" y2={21.8 - ((i + 1) % 3) * 0.9} transform={`rotate(${angle} 12 12)`} />)}
  </g></svg>;
}
