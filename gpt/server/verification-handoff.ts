import type { LocalVerification } from '../shared/types.js';

// A host-launched server receives a free port. A provider may describe the
// default port instead of the host placeholder even while its command uses
// PORT. Keep that local handoff synchronized; attached URLs stay exact.
export function normalizeVerification(verification: LocalVerification): LocalVerification {
  if (!verification.serverCommand || !verification.url ||
      !/\$(?:PORT\b|AGENT_TOWN_PREVIEW_PORT\b|\{(?:PORT|AGENT_TOWN_PREVIEW_PORT)(?=[:}]))/.test(verification.serverCommand)) return verification;
  try {
    const url = new URL(verification.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) return verification;
    const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    return { ...verification, url: `${url.protocol}//${hostname}:{port}${url.pathname}${url.search}${url.hash}` };
  } catch { return verification; }
}
