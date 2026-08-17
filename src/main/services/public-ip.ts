/**
 * Public (internet-facing) IPv4 lookup.
 *
 * This is the one place Clarity talks to a third party, and it is deliberate:
 * a machine cannot know its own public address, only the address an outside
 * observer sees. Nothing about the user is sent — the request carries no body,
 * no identifiers and no query — but it does necessarily reveal their IP to the
 * endpoint, which is inherent to asking the question at all.
 *
 * Consequences that shape the design below:
 *  - The result is cached, so opening the Wi-Fi page repeatedly does not mean
 *    repeated calls.
 *  - A failure caches only briefly, so reconnecting shows the address promptly
 *    instead of waiting out a long TTL.
 *  - The answer is bound to the local network fingerprint: moving to another
 *    network changes the public address, so the cache is dropped when the local
 *    IP or gateway changes.
 *  - The reply is validated strictly. A captive portal answers every request
 *    with its own HTML or redirects to a private address, and neither is a
 *    public IP — treating that as "offline" is the honest reading.
 */

import { isPrivateIpv4 } from './network-security'

export type PublicIpState =
  /** Looked up successfully. `address` is set. */
  | 'ok'
  /** No usable answer: no route, DNS failure, timeout, or a captive portal. */
  | 'offline'
  /** Not looked up yet. */
  | 'unknown'

export interface PublicIpResult {
  address: string | null
  state: PublicIpState
  /** Epoch ms of the last completed attempt, or null if never attempted. */
  checkedAt: number | null
}

/**
 * Endpoints that reply with nothing but the caller's address in plain text.
 * Two, so one being down or blocked is not the end of the feature.
 */
export const PUBLIC_IP_ENDPOINTS = [
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
] as const

/** Per-endpoint budget. Kept short: this must not hold up the page. */
const REQUEST_TIMEOUT_MS = 3_500
/** How long a good answer stands. A public IP rarely changes within this. */
const SUCCESS_TTL_MS = 10 * 60 * 1000
/** How long a failure stands — short, so reconnecting recovers quickly. */
const FAILURE_TTL_MS = 20 * 1000
/** Guards against a hostile or misconfigured endpoint returning a huge body. */
const MAX_RESPONSE_CHARS = 128

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Extract a public IPv4 from an endpoint's reply, or null.
 *
 * Strict on purpose. Anything other than a bare, routable IPv4 — HTML from a
 * captive portal, an error page, a private address, an octet above 255 — is not
 * an answer. Exported for tests.
 */
export function parsePublicIpResponse(body: string | null | undefined): string | null {
  if (!body) return null
  if (body.length > MAX_RESPONSE_CHARS) return null
  const trimmed = body.trim()
  const match = IPV4_RE.exec(trimmed)
  if (!match) return null
  for (let i = 1; i <= 4; i++) {
    const octet = Number.parseInt(match[i], 10)
    if (!Number.isFinite(octet) || octet < 0 || octet > 255) return null
    // Reject a leading zero ("01.2.3.4"), which is not a canonical address.
    if (match[i].length > 1 && match[i].startsWith('0')) return null
  }
  // A public-IP service reporting a private address means something answered
  // that is not the internet — a captive portal or a DNS hijack.
  if (isPrivateIpv4(trimmed)) return null
  return trimmed
}

// ─── cache ──────────────────────────────────────────────────

interface CacheEntry extends PublicIpResult {
  /** Local network identity this answer belongs to. */
  fingerprint: string
}

let cache: CacheEntry | null = null

/** Identifies the network we are on, so a move invalidates the answer. */
export function networkFingerprint(localIpv4: string | null, gateway: string | null): string {
  return `${localIpv4 ?? '-'}|${gateway ?? '-'}`
}

function isFresh(entry: CacheEntry, now: number): boolean {
  const ttl = entry.state === 'ok' ? SUCCESS_TTL_MS : FAILURE_TTL_MS
  return entry.checkedAt != null && now - entry.checkedAt < ttl
}

/** Drop the memo. Exported for tests and for an explicit user-driven refresh. */
export function resetPublicIpCache(): void {
  cache = null
}

/** The cached answer without touching the network. */
export function getCachedPublicIp(): PublicIpResult {
  if (!cache) return { address: null, state: 'unknown', checkedAt: null }
  return { address: cache.address, state: cache.state, checkedAt: cache.checkedAt }
}

// ─── lookup ─────────────────────────────────────────────────

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean
  text: () => Promise<string>
}>

/**
 * Chromium's fetch when running under Electron, so the lookup honours the
 * system/enterprise proxy the user's network requires. Falls back to Node's
 * global fetch outside Electron (tests, CLI).
 */
async function defaultFetch(): Promise<FetchLike> {
  try {
    const { net } = await import('electron')
    if (net && typeof net.fetch === 'function') {
      return net.fetch as unknown as FetchLike
    }
  } catch {
    // Not running under Electron.
  }
  return globalThis.fetch as unknown as FetchLike
}

/**
 * Ask each endpoint in turn until one gives a usable address.
 *
 * Never throws and never rejects: an unreachable internet is an expected state,
 * not an error, and it comes back as `offline`.
 */
export async function lookupPublicIp(
  opts: { fetchImpl?: FetchLike; now?: number } = {},
): Promise<PublicIpResult> {
  const now = opts.now ?? Date.now()
  const doFetch = opts.fetchImpl ?? (await defaultFetch())
  if (typeof doFetch !== 'function') {
    return { address: null, state: 'offline', checkedAt: now }
  }

  for (const url of PUBLIC_IP_ENDPOINTS) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await doFetch(url, { signal: controller.signal })
        if (!res.ok) continue
        const address = parsePublicIpResponse(await res.text())
        if (address) return { address, state: 'ok', checkedAt: now }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Try the next endpoint; exhausting them means offline.
    }
  }

  return { address: null, state: 'offline', checkedAt: now }
}

/**
 * The public IP for the current network, from cache when it is still valid.
 *
 * `localIpv4`/`gateway` identify the network so switching Wi-Fi does not keep
 * showing the previous network's address.
 */
export async function getPublicIp(
  localIpv4: string | null,
  gateway: string | null,
  opts: { fetchImpl?: FetchLike; now?: number; force?: boolean } = {},
): Promise<PublicIpResult> {
  const now = opts.now ?? Date.now()
  const fingerprint = networkFingerprint(localIpv4, gateway)

  if (!opts.force && cache && cache.fingerprint === fingerprint && isFresh(cache, now)) {
    return { address: cache.address, state: cache.state, checkedAt: cache.checkedAt }
  }

  const result = await lookupPublicIp({ fetchImpl: opts.fetchImpl, now })
  cache = { ...result, fingerprint }
  return result
}
