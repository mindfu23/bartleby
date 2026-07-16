import { isNative, kvGet, kvSet, kvRemove } from './storage'

/**
 * Dropbox OAuth 2 with PKCE — the durable replacement for pasted access tokens.
 *
 * Dropbox no longer issues long-lived access tokens: every access token expires
 * in ~4 hours. Durable access comes from a REFRESH token, which does not expire
 * (it can only be revoked), obtained by adding `token_access_type=offline` to
 * the authorize URL. We store the refresh token and silently mint fresh access
 * tokens from it, so the user connects once and never sees a token.
 *
 * PKCE (RFC 7636) means this works with NO app secret, so Bartleby stays a
 * pure client-side app with no backend. The app KEY is a public client
 * identifier — it is meant to ship in the bundle. The app SECRET must never
 * appear here (or anywhere client-side).
 *
 * Two platforms, one flow:
 *  - Web: redirect the page to Dropbox, come back to `<origin>/?code=…`.
 *  - Native: `capacitor://localhost/` is NOT a redirect URI Dropbox will
 *    accept, so we use the custom scheme `bartleby://auth` — legal only
 *    because we're on PKCE — open the system browser, and receive the code
 *    back through a deep link. The app never navigates away, so there's no
 *    page reload to carry state across.
 *
 * Every Dropbox user authorizes THIS one app against their own account; nobody
 * registers an app or generates a token but the developer.
 */

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'

/** Custom scheme redirect for the packaged app. Must be registered in the
 *  Dropbox App Console AND match the Android intent-filter. */
export const NATIVE_REDIRECT = 'bartleby://auth'

/** Refresh token + cached access token. */
const STORE_KEY = 'bartleby-dropbox-auth'
/** PKCE verifier, held only until the code comes back. */
const VERIFIER_KEY = 'bartleby-dropbox-verifier'
/** Web only: set before redirecting so we reopen the picker on return. */
const RESUME_KEY = 'bartleby-dropbox-resume'

/** Refresh this many ms before actual expiry, so a call never races the clock. */
const EXPIRY_SKEW_MS = 60_000

export interface StoredAuth {
  refreshToken: string
  accessToken: string
  /** epoch ms */
  expiresAt: number
}

export class DropboxAuthError extends Error {}

/** The app key. Public by design under PKCE — not a secret. */
export function appKey(): string {
  const key = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined
  if (!key) {
    throw new DropboxAuthError(
      'No Dropbox app key configured (VITE_DROPBOX_APP_KEY). ' +
        'Paste an access token instead, or set the key and redeploy.',
    )
  }
  return key
}

export function isConfigured(): boolean {
  return Boolean(import.meta.env.VITE_DROPBOX_APP_KEY)
}

/** Must match a Redirect URI registered in the Dropbox App Console exactly. */
export function redirectUri(): string {
  return isNative() ? NATIVE_REDIRECT : `${window.location.origin}/`
}

// ---------------------------------------------------------------- PKCE bits

export function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A high-entropy code verifier (RFC 7636 requires 43–128 chars). */
export function randomVerifier(): string {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

/** S256 challenge = base64url(sha256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function buildAuthUrl(key: string, challenge: string, redirect: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', key)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // The bit that yields a refresh token — without it access dies in ~4h.
  url.searchParams.set('token_access_type', 'offline')
  url.searchParams.set('redirect_uri', redirect)
  return url.toString()
}

/**
 * Pull the OAuth params out of a redirect URL. Written against the raw string
 * rather than `new URL()`, because custom schemes like `bartleby://auth?code=…`
 * aren't parsed consistently across engines.
 */
export function paramsFromUrl(url: string): URLSearchParams {
  const q = url.indexOf('?')
  if (q === -1) return new URLSearchParams()
  const hash = url.indexOf('#', q)
  return new URLSearchParams(hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash))
}

// ------------------------------------------------------------------ storage

/**
 * In-memory mirror of the stored auth. Native storage is async but React
 * renders synchronously (isConnected()), so we hydrate once at startup and
 * read from here after that.
 */
let cached: StoredAuth | null = null
let hydrated = false

const listeners = new Set<() => void>()
/** Re-render on connect/disconnect — on native there's no page reload to do it. */
export function subscribeAuth(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const notify = () => listeners.forEach((l) => l())

/** Load persisted auth into memory. Call once before first render. */
export async function initAuth(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const raw = await kvGet(STORE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as StoredAuth
    if (parsed.refreshToken) cached = parsed
  } catch {
    /* unreadable/corrupt — treat as not connected */
  }
}

function save(auth: StoredAuth): void {
  cached = auth
  void kvSet(STORE_KEY, JSON.stringify(auth))
  notify()
}

function load(): StoredAuth | null {
  return cached
}

export function disconnect(): void {
  manualToken = null
  cached = null
  void kvRemove(STORE_KEY)
  notify()
}

/**
 * A pasted short-lived token (fallback / no app key configured). Kept in memory
 * only — never persisted, matching the old "stays in this session" promise.
 */
let manualToken: string | null = null

export function setManualToken(token: string | null): void {
  manualToken = token
  notify()
}

export function isConnected(): boolean {
  return Boolean(manualToken) || load() !== null
}

/** True when connected via OAuth (i.e. access renews itself). */
export function isOAuthConnected(): boolean {
  return !manualToken && load() !== null
}

// -------------------------------------------------------------------- flows

/**
 * Start authorization. On web this navigates the page; on native it opens the
 * system browser (so the user's existing Dropbox session applies) and the code
 * arrives via the `bartleby://auth` deep link.
 */
export async function beginAuth(): Promise<void> {
  const key = appKey()
  const verifier = randomVerifier()
  await kvSet(VERIFIER_KEY, verifier)
  const url = buildAuthUrl(key, await challengeFor(verifier), redirectUri())

  if (isNative()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return
  }
  try {
    sessionStorage.setItem(RESUME_KEY, '1')
  } catch {
    /* fine — we just won't auto-reopen the picker */
  }
  window.location.assign(url)
}

async function postToken(body: URLSearchParams): Promise<StoredAuth> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new DropboxAuthError(`Dropbox auth failed (${res.status}): ${text}`)
  const json = JSON.parse(text) as {
    access_token: string
    expires_in: number
    refresh_token?: string
  }
  return {
    accessToken: json.access_token,
    // A refresh response omits refresh_token — keep the one we already hold.
    refreshToken: json.refresh_token ?? load()?.refreshToken ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

/** Exchange an authorization code for tokens. Shared by both platforms. */
async function exchangeCode(code: string): Promise<void> {
  const verifier = await kvGet(VERIFIER_KEY)
  await kvRemove(VERIFIER_KEY)
  if (!verifier) throw new DropboxAuthError('Auth session expired — please connect again.')
  save(
    await postToken(
      new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: appKey(),
        code_verifier: verifier,
        redirect_uri: redirectUri(),
      }),
    ),
  )
}

/** Handle a redirect URL (deep link on native). Returns true if it was ours. */
export async function completeAuthFromUrl(url: string): Promise<boolean> {
  const params = paramsFromUrl(url)
  const err = params.get('error')
  if (err) throw new DropboxAuthError(`Dropbox authorization was declined (${err}).`)
  const code = params.get('code')
  if (!code) return false
  await exchangeCode(code)
  return true
}

/**
 * Web: if we're back from Dropbox with ?code=…, exchange it and clean the URL.
 * Safe to call on every load; a no-op on native.
 */
export async function completeAuthFromRedirect(): Promise<boolean> {
  if (typeof window === 'undefined' || isNative()) return false
  const params = new URLSearchParams(window.location.search)
  if (!params.get('code') && !params.get('error')) return false
  try {
    return await completeAuthFromUrl(window.location.href)
  } finally {
    stripAuthParams()
  }
}

/** Native: receive the authorization code through the custom-scheme deep link. */
export async function initNativeAuthListener(): Promise<void> {
  if (!isNative()) return
  const { App } = await import('@capacitor/app')
  const { Browser } = await import('@capacitor/browser')
  await App.addListener('appUrlOpen', ({ url }) => {
    if (!url.toLowerCase().startsWith('bartleby://auth')) return
    void completeAuthFromUrl(url)
      .catch((e) => console.error('Dropbox auth did not complete:', e))
      .finally(() => void Browser.close().catch(() => {}))
  })
}

function stripAuthParams(): void {
  const url = new URL(window.location.href)
  for (const p of ['code', 'error', 'error_description', 'state']) url.searchParams.delete(p)
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}

/** Did we just come back from an authorize redirect? Consumes the flag. */
export function consumeResumeFlag(): boolean {
  try {
    const v = sessionStorage.getItem(RESUME_KEY) === '1'
    sessionStorage.removeItem(RESUME_KEY)
    return v
  } catch {
    return false
  }
}

export function needsRefresh(auth: StoredAuth, now = Date.now()): boolean {
  return now >= auth.expiresAt - EXPIRY_SKEW_MS
}

/**
 * A valid access token, refreshed on demand. Every Dropbox call goes through
 * this, so a long editing session never dies at the 4-hour mark.
 */
export async function getAccessToken(): Promise<string> {
  if (manualToken) return manualToken
  const auth = load()
  if (!auth) throw new DropboxAuthError('Not connected to Dropbox.')
  if (!needsRefresh(auth)) return auth.accessToken

  try {
    const next = await postToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        client_id: appKey(),
      }),
    )
    save(next)
    return next.accessToken
  } catch (e) {
    // A revoked/invalid refresh token can never recover — force a reconnect.
    disconnect()
    throw new DropboxAuthError(
      `Dropbox access was revoked or expired — please connect again. (${
        e instanceof Error ? e.message : String(e)
      })`,
    )
  }
}
