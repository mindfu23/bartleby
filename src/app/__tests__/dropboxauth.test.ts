import { describe, it, expect } from 'vitest'
import {
  base64url,
  randomVerifier,
  challengeFor,
  buildAuthUrl,
  needsRefresh,
} from '../dropboxauth'

describe('base64url', () => {
  it('encodes without +, / or = padding', () => {
    // 0xfb 0xff produces "+/8=" in standard base64 — all three special cases.
    const out = base64url(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(out).not.toMatch(/[+/=]/)
    expect(out).toBe('-__-')
  })
})

describe('PKCE code challenge', () => {
  it('matches the RFC 7636 appendix B reference vector', async () => {
    // If this breaks, Dropbox will reject every authorization exchange.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await challengeFor(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates verifiers within the RFC length bounds and charset', () => {
    const v = randomVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('generates a different verifier each time', () => {
    expect(randomVerifier()).not.toBe(randomVerifier())
  })
})

describe('buildAuthUrl', () => {
  const url = () => new URL(buildAuthUrl('KEY123', 'CHAL', 'https://example.com/'))

  it('requests offline access so Dropbox returns a refresh token', () => {
    // Without this the app dies at the ~4h access-token expiry.
    expect(url().searchParams.get('token_access_type')).toBe('offline')
  })

  it('uses the S256 code flow with the app key and redirect', () => {
    const p = url().searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe('CHAL')
    expect(p.get('client_id')).toBe('KEY123')
    expect(p.get('redirect_uri')).toBe('https://example.com/')
  })

  it('never includes an app secret', () => {
    expect(url().searchParams.has('client_secret')).toBe(false)
  })
})

describe('needsRefresh', () => {
  const auth = (expiresAt: number) => ({ refreshToken: 'r', accessToken: 'a', expiresAt })

  it('is false for a token with plenty of life left', () => {
    expect(needsRefresh(auth(10_000_000), 5_000_000)).toBe(false)
  })

  it('is true once expired', () => {
    expect(needsRefresh(auth(1_000), 5_000)).toBe(true)
  })

  it('refreshes early, before the token actually expires', () => {
    // 30s from expiry is inside the skew — refresh rather than race the clock.
    const now = 1_000_000
    expect(needsRefresh(auth(now + 30_000), now)).toBe(true)
    expect(needsRefresh(auth(now + 120_000), now)).toBe(false)
  })
})
