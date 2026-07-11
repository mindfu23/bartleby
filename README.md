# Bartleby

A Scrivener 3 project editor for the browser — and, next, Android. Open a
`.scriv` project, browse the binder, read and edit document text, add new
documents, and save back safely.

Named for the scrivener who would prefer not to.

## How it works (the safety story)

Scrivener's RTF files are treated as **byte sequences, not documents**:

- A single pass builds a *run map* — the byte span of every piece of
  renderable text — without parsing-and-reserializing the RTF.
- Your edit is diffed against the plain-text projection and **spliced into a
  copy of the original bytes**. Everything you didn't touch stays
  byte-identical, including all formatting, font tables, and headers.
- Every write is validated by re-parsing; a splice that would corrupt
  structure throws instead of saving.
- New documents clone the RTF header from an existing document in the same
  project (never hand-authored).
- The `.scrivx` binder is mutated by string splice too. `docs.checksum` is
  **regenerated** on export (real SHA-1s over the emitted bytes) so external-
  change detection stays honest; the caches Scrivener can rebuild itself
  (`search.indexes`, `binder.autosave`, `binder.backup`) are stripped.

See `architecture-frontend-boundary.md`, `phase0-handoff-scriv-roundtrip-spike.md`,
and `phase1-handoff-edit-integration-and-sync.md` for the full design
contract, and `NOTES.md` for empirical findings.

## Usage

1. **Open** — pick your `.scriv` folder (desktop browsers) or a `.zip` of it
   (mobile). All processing is client-side; nothing is uploaded anywhere.
2. **Browse & edit** — select documents in the binder, edit the plain-text
   projection, Save.
3. **Save back** — in Chrome/Edge, folder mode enables **Save to project
   folder**, which writes only the changed files straight back into the
   `.scriv` you opened (close it in Scrivener first). A backup zip of the
   original downloads automatically before the first write. Firefox/Safari
   don't support folder writes — use **Export copy (.zip)** there instead.

**Current limitation:** editing is plain-text. Formatting *outside* your
edits is preserved byte-for-byte; text you change is written back
unformatted. Applying new formatting (Phase 1, Gate 6) is not built yet.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (RTF run-map, scrivx, diff, session)
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

## Verification gates (manual, in desktop Scrivener)

The automated tests lock in invariants, but only desktop Scrivener can pass
the real gates (phase0 §11): save/export an untouched project (Gate 0), an
edited one (Gate 2), and one with an added document (Gate 3), and confirm
Scrivener opens each with no error or repair dialog. Record findings in
`NOTES.md`.

## Roadmap

- **Now:** web version (this repo); finish local mutation gates (2/3/4/0b).
- **v1 → Android:** Dropbox-backed editing (read/write `.scriv` from Dropbox
  via API), Capacitor 7 shell over the same core/session layers, conflict-copy
  on divergence. Verified against Dropbox + Mac Scrivener. See
  `android-v1-dropbox-plan.md`. Storage is Dropbox-only in v1 (no local/SAF).
- **Phase 2:** rich-text editing (Phase 1 Problem A), conflict auto-merge,
  comment/image editing, iOS/Windows Scrivener verification.

---

*Original repo note:* repo for an Android app that can read and write
Scrivener files, also a web version testing and perhaps alternate use.
