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
 * Every Dropbox user authorizes THIS one app against their own account; nobody
 * registers an app or generates a token but the developer.
 */

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'

/** Refresh token + cached access token. Survives reloads. */
const STORE_KEY = 'bartleby-dropbox-auth'
/** PKCE verifier, held only across the authorize redirect. */
const VERIFIER_KEY = 'bartleby-dropbox-verifier'
/** Set before redirecting so we can reopen the Dropbox picker on return. */
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
  return `${window.location.origin}/`
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

// ------------------------------------------------------------------ storage

function save(auth: StoredAuth): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(auth))
  } catch {
    /* storage blocked — auth then lasts only for this page's lifetime */
  }
}

function load(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    return parsed.refreshToken ? parsed : null
  } catch {
    return null
  }
}

export function disconnect(): void {
  manualToken = null
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * A pasted short-lived token (fallback / no app key configured). Kept in memory
 * only — never persisted, matching the old "stays in this session" promise.
 */
let manualToken: string | null = null

export function setManualToken(token: string | null): void {
  manualToken = token
}

export function isConnected(): boolean {
  return Boolean(manualToken) || load() !== null
}

/** True when connected via OAuth (i.e. access renews itself). */
export function isOAuthConnected(): boolean {
  return !manualToken && load() !== null
}

// -------------------------------------------------------------------- flows

/** Kick off the authorize redirect. Returns via completeAuthFromRedirect(). */
export async function beginAuth(): Promise<void> {
  const key = appKey()
  const verifier = randomVerifier()
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(RESUME_KEY, '1')
  const url = buildAuthUrl(key, await challengeFor(verifier), redirectUri())
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

/**
 * If we're back from Dropbox with ?code=…, exchange it for tokens and clean the
 * URL. Returns true if an auth was completed. Safe to call on every load.
 */
export async function completeAuthFromRedirect(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const denied = params.get('error')
  if (denied) {
    stripAuthParams()
    throw new DropboxAuthError(`Dropbox authorization was declined (${denied}).`)
  }
  if (!code) return false

  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  if (!verifier) {
    stripAuthParams()
    throw new DropboxAuthError('Auth session expired — please connect again.')
  }

  const auth = await postToken(
    new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: appKey(),
      code_verifier: verifier,
      redirect_uri: redirectUri(),
    }),
  )
  save(auth)
  stripAuthParams()
  return true
}

function stripAuthParams(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  url.searchParams.delete('state')
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
