import { useMemo } from 'react'
import type { ProjectSession, BinderNode } from '../app/session'
import { isFolderType } from './BinderTree'

function words(s: string): number {
  const t = s.trim()
  return t ? t.split(/\s+/).length : 0
}

/** Cheap, real project stats from the open session. Streaks / daily history
 *  (from Scrivener's writing.history) arrive in a later phase. */
function tally(session: ProjectSession) {
  let docs = 0
  let folders = 0
  let totalWords = 0
  let longest = { title: '', words: 0 }
  const walk = (nodes: BinderNode[]) => {
    for (const n of nodes) {
      if (isFolderType(n.type)) {
        folders++
      } else if (session.hasDocFile(n.uuid)) {
        docs++
        const w = words(session.readDoc(n.uuid))
        totalWords += w
        if (w > longest.words) longest = { title: n.title || '(untitled)', words: w }
      }
      walk(n.children)
    }
  }
  walk(session.binderTree())
  return { docs, folders, totalWords, longest }
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="text-2xl font-semibold text-accent">{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  )
}

export default function InsightsPanel({
  session,
  version,
}: {
  session: ProjectSession
  /** bump to recompute after edits */
  version: number
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const t = useMemo(() => tally(session), [session, version])

  return (
    <div className="mx-auto max-w-lg p-4">
      <h2 className="font-serif text-2xl text-accent">Insights</h2>
      <p className="mt-1 text-sm text-ink-soft">{session.projectName}.scriv</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat value={t.totalWords.toLocaleString()} label="Words" />
        <Stat value={t.docs.toLocaleString()} label="Documents" />
        <Stat value={t.folders.toLocaleString()} label="Folders" />
        <Stat
          value={
            t.docs ? Math.round(t.totalWords / t.docs).toLocaleString() : '0'
          }
          label="Avg / doc"
        />
      </div>

      {t.longest.words > 0 && (
        <div className="mt-3 rounded-xl border border-edge bg-surface p-4">
          <div className="text-xs uppercase tracking-wide text-ink-faint">Longest document</div>
          <div className="mt-1 truncate text-sm text-ink">{t.longest.title}</div>
          <div className="text-sm text-accent">{t.longest.words.toLocaleString()} words</div>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Daily streaks, session targets, and writing history (from Scrivener’s
        writing.history) are coming in a future update.
      </p>
    </div>
  )
}
