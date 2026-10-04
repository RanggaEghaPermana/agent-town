import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/types';

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Town': '1' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Permintaan gagal.');
  return value as T;
}

export function useOffice() {
  const [state, setState] = useState<Snapshot>({ tasks: [], health: { installed: false, loggedIn: false, provider: 'Memeriksa…' }, workspaceRoot: '' });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, liveStateReceived = false, socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    api<Snapshot>('/api/state').then(value => { if (!stopped && !liveStateReceived) setState(value); }).catch(error => { if (!stopped && !liveStateReceived) setError(error.message); });
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onopen = () => { if (!stopped) { setConnected(true); setError(''); } };
      socket.onmessage = event => { try { const value = JSON.parse(event.data); if (!stopped && value.type === 'state') { liveStateReceived = true; setState(value.state); } } catch { /* Invalid events cannot update UI. */ } };
      socket.onclose = () => { if (!stopped) { setConnected(false); timer = setTimeout(connect, 2000); } };
      socket.onerror = () => { socket?.close(); };
    }
    connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close(); };
  }, []);
  return { state, connected, error, setError };
}
