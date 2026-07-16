import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * Small key/value seam so the app layer doesn't care where it runs.
 *
 * Web  → localStorage.
 * Native → Capacitor Preferences, which is app-private storage (Android
 * SharedPreferences). That matters for the Dropbox refresh token: on web it's
 * reachable by any XSS on the origin, whereas Preferences is isolated to the
 * app. NOTE: app-private is not the same as encrypted-at-rest — a rooted device
 * can still read it. Keystore-backed storage is a follow-up; this is already
 * strictly better than shipping localStorage inside an APK.
 *
 * Async by necessity (Preferences is), so callers that need a synchronous read
 * (e.g. React render) must hydrate an in-memory cache at startup.
 */
export const isNative = (): boolean => Capacitor.isNativePlatform()

export async function kvGet(key: string): Promise<string | null> {
  if (isNative()) return (await Preferences.get({ key })).value
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage blocked (private mode / embedded webview)
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (isNative()) {
    await Preferences.set({ key, value })
    return
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* best-effort */
  }
}

export async function kvRemove(key: string): Promise<void> {
  if (isNative()) {
    await Preferences.remove({ key })
    return
  }
  try {
    localStorage.removeItem(key)
  } catch {
    /* best-effort */
  }
}
