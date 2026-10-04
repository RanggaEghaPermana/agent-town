import { lazy, Suspense, useEffect, useState } from 'react';
import ClaudeOffice from './App';
import './office-switcher.css';
const GPTOffice = lazy(() => import('../gpt/src/App'));
type Office = 'claude' | 'gpt';
export default function OfficeSwitcher() {
  const [office, setOffice] = useState<Office>(() => {
    let initial: Office = 'claude';
    try { if (localStorage.getItem('agent-town-office-v1') === 'gpt') initial = 'gpt'; } catch {}
    // Set before the first paint so the office's theme never flashes in unstyled.
    document.body.dataset.office = initial;
    return initial;
  });
  useEffect(() => { document.body.dataset.office = office; try { localStorage.setItem('agent-town-office-v1', office); } catch {} }, [office]);
  return <>
    <nav className={`office-switcher ${office}`} aria-label="Pilih kantor AI">
      <button aria-pressed={office === 'claude'} onClick={() => setOffice('claude')}><span className="provider-symbol claude-symbol" aria-hidden="true">✳</span>Claude</button>
      <button aria-pressed={office === 'gpt'} onClick={() => setOffice('gpt')}><svg className="provider-symbol gpt-symbol" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.9">{[0, 60, 120].map(angle => <rect key={angle} x="7.6" y="2.2" width="8.8" height="19.6" rx="4.4" transform={`rotate(${angle} 12 12)`} />)}</g></svg>GPT</button>
    </nav>
    <Suspense fallback={<div className="office-loading" role="status">Membuka kantor GPT…</div>}>{office === 'claude' ? <ClaudeOffice /> : <GPTOffice />}</Suspense>
  </>;
}
