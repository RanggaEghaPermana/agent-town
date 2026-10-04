import type { Agent } from '../shared/types';
import { APPEARANCES } from './scene/character';

// A flat avatar in a neutral circle, drawn from the same appearance the 3D character wears.
export function Portrait({ agent, size = 44 }: { agent: Agent; size?: number }) {
  const look = APPEARANCES[agent.id], ink = '#0d0d0d';
  return <svg className="portrait" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <defs><clipPath id={`portrait-${agent.id}`}><circle cx="24" cy="24" r="24" /></clipPath></defs>
    <g clipPath={`url(#portrait-${agent.id})`}>
      <rect width="48" height="48" fill="#ececec" />
      <path d="M7.5 48c0-9.5 7-14.5 16.5-14.5S40.5 38.5 40.5 48z" fill={look.shirt} />
      <rect x="20.5" y="28" width="7" height="8" rx="3" fill={look.skin} />
      {look.longHair && <path d="M12.5 22c0-9 5-14 11.5-14s11.5 5 11.5 14v11.5c0 2.2-3.2 2.2-3.2 0V24H15.7v9.5c0 2.2-3.2 2.2-3.2 0z" fill={look.hair} />}
      <ellipse cx="24" cy="22.5" rx="9.3" ry="10.2" fill={look.skin} />
      <path d="M14.2 21c-.6-8 4.3-13 9.8-13s10.4 5 9.8 13c-2.6-4.2-5.6-6-9.8-6s-7.2 1.8-9.8 6z" fill={look.hair} />
      {look.beard && <path d="M15.4 24.5c.8 7.6 4.8 9.3 8.6 9.3s7.8-1.7 8.6-9.3c-2 3-5 4-8.6 4s-6.6-1-8.6-4z" fill={look.hair} />}
      <circle cx="20.3" cy="22.8" r="1.2" fill={ink} /><circle cx="27.7" cy="22.8" r="1.2" fill={ink} />
      {!look.beard && <path d="M21.2 27.3c1.7 1.4 3.9 1.4 5.6 0" fill="none" stroke={ink} strokeWidth="1.1" strokeLinecap="round" opacity=".65" />}
      {look.glasses && <g fill="none" stroke={ink} strokeWidth="1.05"><circle cx="20.3" cy="22.8" r="3.3" /><circle cx="27.7" cy="22.8" r="3.3" /><path d="M23.6 22.5h.8" /></g>}
    </g>
  </svg>;
}

// The office mark: three interlocked loops forming a six-petal knot.
export function Knot({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.7">
    {[0, 60, 120].map(angle => <rect key={angle} x="7.6" y="2.2" width="8.8" height="19.6" rx="4.4" transform={`rotate(${angle} 12 12)`} />)}
  </g></svg>;
}
