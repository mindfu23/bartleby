# NOTES — empirical record (phase0 §12.5)

This file records verified knowledge of Scrivener's format write rules.
Per the handoff docs, this is the primary deliverable of the spike work.

## Status: 2026-06-12 — web implementation built, Scrivener gates NOT yet run

The TypeScript core implements the phase0 techniques (run-map, byte splice,
header cloning, cache stripping) and passes its unit-test invariants, but
**no output has been opened in desktop Scrivener yet**. Everything below the
line is hypothesis, not verified knowledge, until the gates run.

### Implementation decisions (recorded, not yet validated by Scrivener)

- **Language deviation:** core is TypeScript (browser/Capacitor), not Rust.
  User direction 2026-06-12: web-first on Netlify, then Android via
  Capacitor. Three-layer boundary contract from
  `architecture-frontend-boundary.md` retained.
- **RTF handling:** files treated as latin1 strings (1 char = 1 byte) so all
  offsets are byte offsets. Projection decodes `\'hh` per cp1252 and `\uN?`;
  `\par`/`\line`/`\<newline>` project as `\n`; `fonttbl`/`colortbl`/
  `stylesheet`/`info`/`pict`/list tables and all `{\*...}` groups skipped.
- **Replacement encoding:** non-ASCII written as `\uN?` escapes (not `\'hh`),
  newlines as `\par `. Assumes `\uc1` (Scrivener's default). A file declaring
  `\uc0` would make the `?` fallback render as text — the post-splice
  validation would catch and refuse such a write.
- **Splice hazard noted:** inserting text that begins with a digit/letter
  immediately after a control word lacking its delimiter space would extend
  the control word. Not auto-fixed; the re-parse validation throws instead of
  writing a corrupt file.
- **`\bin` refused** (phase0 fixture constraint: text-only documents).
- **Cache stripping on export** (`docs.checksum`, `search.indexes`,
  `binder.autosave`, `binder.backup`): the phase0 §8 "Scrivener rebuilds
  caches" hypothesis. UNVERIFIED. Phase 1 warns this may trigger
  external-change handling on Dropbox-synced projects.
- **Root `Modified`/`ModID`** freshened on export. Whether Scrivener cares
  about stale values: untested.
- **New BinderItems:** UUID v4 uppercase-hyphenated; `MetaData` cloned
  verbatim from the first existing `Type="Text"` item; `<Children>` wrapper
  created when the parent has none.

### Browser smoke test (2026-06-12, synthetic fixture)

Full UI flow verified via Playwright against the dev server: open zipped
project → binder tree correct (nesting, XML entities decoded) → read doc
(accents correct) → edit + save (dirty tracking works) → add document under
Draft (uppercase UUID, cloned header, scrivx BinderItem present) → export.
Exported zip inspected: caches stripped, `version.txt` kept, root ModID
freshened, untouched document **byte-identical** to input, RTF header of the
edited document preserved.

**Refinement applied same day:** the first cut used a single-span
prefix/suffix diff, and the smoke test showed an edit near the start AND end
of a document flattened interior bold/italic formatting. Replaced with a
two-level LCS diff (lines, then words within changed blocks, char-tightened;
`src/core/diff.ts`) so untouched interior runs keep their original bytes.
Regression test asserts `\b bold\b0` and `\'e9` survive a start+end edit.
Formatting *inside* a changed word/region is still flattened — true
formatting-application is phase 1 Gate 6, not built.

### Gate status

| Gate | Status |
|---|---|
| Gate A (thin-client boundary) | Held by construction; core has no DOM/React/print |
| Gate 0 (null round-trip) | **NOT RUN** — needs a real project + desktop Scrivener |
| Gate 1 (read fidelity) | Unit-tested on synthetic fixture only |
| Gate 2 (edit) | Unit-tested on synthetic fixture only |
| Gate 3 (add) | Unit-tested on synthetic fixture only |
| Gate 4 (combined) | NOT RUN |

### How to run Gate 0

1. Open a real Scrivener 3 project (or a copy) in the web app.
2. Export immediately with no edits.
3. Unzip, open the `.scriv` in desktop Scrivener.
4. Pass = opens with no error or repair dialog, all content identical.
5. Record the result (and any complaint verbatim) here.
