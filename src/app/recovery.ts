/**
 * Crash/close recovery — persists the working session to IndexedDB (Tier 2
 * auto-save). This is a browser-local safety net, NOT the project file: the
 * `.scriv` is only written on explicit Export / Save-to-folder. On next open,
 * the app offers to restore whatever was last persisted.
 *
 * Kept dependency-free; the snapshot (Map/Uint8Array) is stored via structured
 * clone directly. All ops are best-effort and never throw into the caller —
 * recovery must never break the app.
 */
import type { SessionSnapshot } from './session'

const DB_NAME = 'bartleby'
const STORE = 'recovery'
const KEY = 'current'
const DB_VERSION = 1

export interface RecoveryRecord {
  projectName: string
  savedAt: number
  snapshot: SessionSnapshot
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE)
        const req = run(store)
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Persist the current working session. Best-effort; logs and swallows errors. */
export async function saveRecovery(snapshot: SessionSnapshot): Promise<void> {
  try {
    const record: RecoveryRecord = { projectName: snapshot.projectName, savedAt: Date.now(), snapshot }
    await tx('readwrite', (s) => s.put(record, KEY))
  } catch (e) {
    console.warn('recovery: save failed', e)
  }
}

/** Load the last-persisted session, or null if none / on error. */
export async function loadRecovery(): Promise<RecoveryRecord | null> {
  try {
    const record = await tx<RecoveryRecord | undefined>('readonly', (s) => s.get(KEY))
    return record ?? null
  } catch (e) {
    console.warn('recovery: load failed', e)
    return null
  }
}

/** Discard the persisted session (e.g. after the user chooses not to restore). */
export async function clearRecovery(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(KEY))
  } catch (e) {
    console.warn('recovery: clear failed', e)
  }
}
