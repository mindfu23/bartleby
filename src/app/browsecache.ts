import { kvGet, kvSet } from './storage'
import type { DropboxProject } from './dropboxio'

/**
 * Last-known Dropbox browse state, so reopening the picker shows the project
 * list INSTANTLY instead of waiting on the network. The listing is refreshed in
 * the background and replaces this — stale-while-revalidate.
 *
 * Cheap and safe to be stale: it's a list of names/paths, and opening a project
 * always fetches live. The worst case is briefly showing a project that has
 * since been renamed, which the refresh corrects a moment later.
 */
const KEY = 'bartleby-dropbox-browse'

export interface BrowseCache {
  root: string
  account: string | null
  projects: DropboxProject[]
  /** epoch ms of the last successful listing */
  at: number
}

export async function loadBrowseCache(): Promise<BrowseCache | null> {
  try {
    const raw = await kvGet(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BrowseCache
    return Array.isArray(parsed.projects) ? parsed : null
  } catch {
    return null
  }
}

export async function saveBrowseCache(cache: BrowseCache): Promise<void> {
  try {
    await kvSet(KEY, JSON.stringify(cache))
  } catch {
    /* best-effort — the cache is an optimisation, never a source of truth */
  }
}

/** "just now" / "5 min ago" / "2 hr ago" / "3 days ago" */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.round(h / 24)} days ago`
}
