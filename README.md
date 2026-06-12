# Bartleby

A Scrivener 3 project editor for the browser — and, next, Android. Open a
`.scriv` project, browse the binder, read and edit document text, add new
documents, and export a clean copy. The original project is never modified.

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
- The `.scrivx` binder is mutated by string splice too; cache files
  (`docs.checksum`, `search.indexes`, `binder.autosave`, `binder.backup`)
  are stripped on export so Scrivener rebuilds them.

See `architecture-frontend-boundary.md`, `phase0-handoff-scriv-roundtrip-spike.md`,
and `phase1-handoff-edit-integration-and-sync.md` for the full design
contract, and `NOTES.md` for empirical findings.

## Usage

1. **Open** — pick your `.scriv` folder (desktop browsers) or a `.zip` of it
   (mobile). All processing is client-side; nothing is uploaded anywhere.
2. **Browse & edit** — select documents in the binder, edit the plain-text
   projection, Save.
3. **Export** — downloads `<Project>-edited.scriv.zip`. Unzip it and open the
   `.scriv` folder in Scrivener to verify.

**Current limitation:** editing is plain-text. Formatting *outside* your
edits is preserved byte-for-byte; text you change is written back
unformatted. Applying new formatting (Phase 1, Gate 6) is not built yet.

## Commands

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (RTF run-map, scrivx, session)
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

## Verification gates (manual, in desktop Scrivener)

The automated tests lock in invariants, but only desktop Scrivener can pass
the real gates (phase0 §11): export an untouched project (Gate 0), an edited
one (Gate 2), and one with an added document (Gate 3), unzip each, and
confirm Scrivener opens them with no error or repair dialog. Record findings
in `NOTES.md`.

## Roadmap

- **Now:** web version (this repo) — refine on Netlify.
- **Next:** Android via Capacitor 7 wrapping the same core/session layers.
- **Later:** rich-text editing (Phase 1 Problem A), Dropbox sync with
  conflict detection (Phase 1 Problem B).
