/**
 * What this deployment can honestly say about blockchain anchoring.
 *
 * The API's GET /health reports `anchorMode` ('onchain' when passports are
 * anchored through MATERIAL_REGISTRY_ADDRESS, 'simulated' when only the
 * fingerprint is prepared), the chain id and a human-readable network label.
 * Marketing copy must follow that, never claim more: a simulated or unknown
 * deployment is described as tamper-evident, not as anchored.
 */

export interface TrustMode {
  anchorMode: 'onchain' | 'simulated' | 'unknown';
  chainId: string | null;
  networkLabel: string | null;
}

export const UNKNOWN_TRUST_MODE: TrustMode = {
  anchorMode: 'unknown',
  chainId: null,
  networkLabel: null,
};

export function parseTrustMode(body: unknown): TrustMode {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return UNKNOWN_TRUST_MODE;
  const anchorMode =
    data['anchorMode'] === 'onchain' || data['anchorMode'] === 'simulated'
      ? data['anchorMode']
      : 'unknown';
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return {
    anchorMode,
    chainId: text(data['chainId']),
    networkLabel: text(data['chainNetworkLabel']),
  };
}

/** Server-side read of the API's trust mode. Never throws; unknown on any failure. */
export async function fetchTrustMode(): Promise<TrustMode> {
  const apiUrl = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  try {
    const res = await fetch(`${apiUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return UNKNOWN_TRUST_MODE;
    return parseTrustMode(await res.json());
  } catch {
    return UNKNOWN_TRUST_MODE;
  }
}

export interface TrustCopy {
  headline: string;
  cardTitle: string;
  cardDescription: string;
}

export function trustCopy(mode: TrustMode): TrustCopy {
  if (mode.anchorMode === 'onchain') {
    const where = mode.networkLabel ?? 'a VeChainThor chain';
    return {
      headline: `TRACE issues material passports anchored on ${where} for reclaimed construction materials, enabling circular economy hubs to buy and sell with trust and compliance.`,
      cardTitle: 'Blockchain Anchored',
      cardDescription: `Each passport's fingerprint is recorded on ${where}. Anyone can re-check a passport against the chain from its passport page.`,
    };
  }
  return {
    headline:
      'TRACE issues tamper-evident material passports for reclaimed construction materials, enabling circular economy hubs to buy and sell with trust and compliance.',
    cardTitle: 'Tamper-evident',
    cardDescription:
      'Every passport carries a cryptographic fingerprint anyone can re-check. On-chain anchoring is not enabled in this deployment.',
  };
}
