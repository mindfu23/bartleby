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

### Direct save-back added (2026-06-12, second pass)

Folder mode (File System Access API, Chrome/Edge desktop) saves changes
directly into the opened `.scriv`: minimal delta only (dirty `content.rtf`
files + freshened `.scrivx`), the four cache files deleted, and a backup zip
of the pristine original auto-downloaded before the first write. Verified
in-browser against a stubbed directory handle: writes/deletes exactly as
specified, interior `\b bold\b0` and `\'e9` bytes preserved through the real
save path. This abandons phase0's "never mutate the input" rule by design
(direct save IS the product goal); the automatic backup is the mitigation.
Firefox/Safari/mobile keep the export-copy path. Android (Capacitor) will
use native filesystem APIs instead.

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

---

## Status: 2026-07-01 — REAL fixtures inventoried (phase0 §13 step 2)

Three real Scrivener-3 projects added at repo root (authored in
`SCRMAC-3.5.2-17487`, File Format `Version="2.0"`, `version.txt` = `23`):
`example.scriv`, `example_v1.scriv`, `example_v2-comments.scriv`. They are
evolutions of one project (shared Data UUIDs). Ground truth below; where it
contradicts the handoff spec, **the fixture wins**.

### KEY FINDING — `docs.checksum` is computable, not just strippable (resolves phase0 §8)

`Files/Data/docs.checksum` is plain text, one line per RTF file:

```
<lowercase-uuid>/content.rtf=<sha1-hex-of-file-bytes>
```

**Verified:** `sha1(7F98…/content.rtf)` = `50dc389980feefa610bbe250e44981c63b4fef64`,
the exact value in the file. Confirmed:
- algorithm = **SHA-1** over the raw file bytes (not MD5/SHA-256);
- key path uses a **lowercase** UUID (the `.scrivx` uses uppercase — mind the case);
- **both `content.rtf` and `notes.rtf`** get entries (see EBF76BC5);
- only `Data/<uuid>/*.rtf` files are listed, nothing else.

**Action:** upgrade the core from "strip `docs.checksum` and hope Scrivener
rebuilds" to **regenerate it correctly** on write (SHA-1 each RTF, lowercase
path, `\n`-joined). This directly de-risks the phase-1 Dropbox concern: a
correct checksum means Scrivener won't flag spurious external changes on sync.
`search.indexes` is regenerable XML too but low-value; stripping it is fine.

### Fixture safety — only `example_v1.scriv` is text-only

`\pict` (embedded images) present in real docs:
- `example.scriv`: D9AAD581 content.rtf (301 KB), EBF76BC5 content.rtf (93 KB) + notes.rtf (433 KB) all contain `\pict`.
- `example_v2-comments.scriv`: EBF76BC5 content.rtf + notes.rtf contain `\pict`.
- **`example_v1.scriv`: clean — no `\pict`, no `\bin`, all docs small.**

So **run Gate 0 on `example_v1.scriv` first** (satisfies the §6/§10 text-only
constraint). The image-bearing projects are a *later* test: the core lists
`pict` among skipped groups, so byte-preservation *should* keep images intact
through a splice, but that is UNVERIFIED on real `\pict` and is the right
Gate-0b. Encoding is `\ansicpg1252` with **no explicit `\uc`** (default
`\uc1`); real accents use `\'hh` for cp1252 (`\'f6`) and `\uN` beyond it
(`\u462`) — the core's all-`\uN?` replacement output is valid and round-trips,
just not byte-identical to Scrivener's style (fine; only untouched bytes must match).

### `.scrivx` structure — confirms string-splice, not reserialize

Root `<ScrivenerProject>` carries far more than `<Binder>`: `<Collections>`,
`<SectionTypes>`, `<LabelSettings>`, `<StatusSettings>`, `<ProjectTargets>`,
`<RecentWritingHistory>`, `<PrintSettings>`. Reserializing all of that is
needless risk — the existing invariant (#4, splice into original XML) is the
right call, reaffirmed against real data.

Per-item facts the binder model must handle:
- **Untitled documents omit `<Title>` entirely** (D9AAD581, 7F9869D2,
  8064FE5E have none). Scrivener shows a *derived* title (first line of text).
  Verify the binder UI derives a fallback instead of rendering blank rows.
- `MetaData` varies: most items are just `<IncludeInCompile>Yes</IncludeInCompile>`,
  but some carry `<LabelID>`, `<StatusID>`, `<NotesTextSelection>`. Cloning
  `MetaData` from the *first* `Type="Text"` item (minimal) stays safe.
- A `<TextSettings><TextSelection>col,len</TextSelection></TextSettings>`
  sibling of `MetaData` holds cursor state; new docs can omit it.
- Container types seen: `DraftFolder`, `Folder`, `ResearchFolder`,
  `TrashFolder`, plus `Type="Text"`. **Deleted docs live in `TrashFolder`**
  and remain on disk (680225FA) — "delete" = move to Trash, not remove files.

### Comments (phase-1 scope, flagged not solved)

`example_v2-comments.scriv` differs from `example.scriv` only in D9AAD581
content.rtf. That file contains **no `Scrv_`/`annotation`/`\v` token** — so
Scrivener-3 linked-comment storage is NOT an obvious inline RTF marker here
and needs dedicated reverse-engineering before phase-1 comment handling.
Until then, comments must survive as opaque preserved bytes, never rewritten.

### SOLVED — Scrivener-3 comment storage (was the last open unknown)

Adding a comment in Scrivener to the text "Screenshot attached." in
`example_v1.scriv` (doc 447716A1) revealed the full mechanism. Comments are
**two coordinated pieces**, not an inline `Scrv_` token:

1. **Sidecar file `Files/Data/<uuid>/content.comments`** — XML, one `<Comment>`
   per linked comment, the comment body stored as its own RTF inside CDATA:
   ```xml
   <Comments>
     <Comment ID="4069A064-…" Color="0.99913 0.954826 0.756384"><![CDATA[{\rtf1…\cf0 comment text}]]></Comment>
   </Comments>
   ```
2. **Anchor in `content.rtf`** — the commented range is wrapped in a Word-style
   hyperlink field keyed by the comment UUID via a `scrivcmt://` scheme:
   ```
   {\field{\*\fldinst{HYPERLINK "scrivcmt://4069A064-…"}}{\fldrslt Screenshot attached.}}
   ```
   Binding: `scrivcmt://<UUID>` in the field ⇄ `<Comment ID="<UUID>">` in the sidecar.

Implications:
- **Read/preserve likely works already, by construction — but verify.** The
  generic run-map rules should handle it: `{\*\fldinst…}` begins with `\*` so it
  is skipped (URL not projected), while `{\fldrslt Screenshot attached.}` is a
  normal group so the *visible* commented text projects correctly; and
  `content.comments` rides through as an unknown file in the project file-map on
  export. **UNVERIFIED against a real `\field`** — add a comment-bearing doc to
  Gate 1 (read fidelity) and Gate 0b (round-trip) coverage. Risk if wrong: a
  wholesale `\field` skip would silently DROP commented text from the projection.
- **Comment *awareness* is new feature work** (display in a comment UI, edit,
  add, remove): parse `content.comments`, resolve `scrivcmt://` anchors, and to
  add a comment — mint a UUID, append a `<Comment>` (create the sidecar if
  absent), and wrap the target range with the `\field…\fldrslt…` form above.
- **Images in comments are now unblocked:** the comment body is itself RTF in
  CDATA, so a `\pict` there is Tier-2/Tier-3 of `image-support-roadmap.md`
  applied to the comment's RTF.
- **`\uc` is dynamic.** The comment body writes `\uc0\u8239` (a narrow
  no-break space, U+202F, with zero fallback bytes). A reader that assumes
  `\uc1` and always eats one byte after every `\uN` will corrupt such runs.
  Track `\uc` state per group.

### CONFIRMED — `docs.checksum` is a sync cache, not a load-time gate

After the comment was added, on-disk `docs.checksum` for 447716A1 still held the
**pre-edit** hash (`b2ffde31…`) while the file now hashes to `2ebc2319…`.
Scrivener left it stale (it reconciles on close/sync). Conclusions:
- A wrong/stale/missing `docs.checksum` does **not** block opening — it drives
  external-change/conflict detection. This de-risks both strip-and-rebuild and
  our preferred **regenerate-on-write** (SHA-1) plan.
- `content.comments` is **not** listed in `docs.checksum` (only `content.rtf`
  and `notes.rtf` are). Do not add it when regenerating.

### IMPLEMENTED — `docs.checksum` regeneration (2026-07, `checksum.ts` + `sha1.ts`)

Export now **regenerates** `docs.checksum` instead of relying on Scrivener to
rebuild it. Empirical facts nailed down while implementing:
- **Digest = plain SHA-1 over the raw `content.rtf`/`notes.rtf` bytes** (no
  transform). Proven: `example.scriv`'s on-disk checksum matches our SHA-1
  **5/5**. `example_v1`/`v2` mismatch only on *stale* entries Scrivener left
  behind (same `d9aad581` stale in both, since v2 derives from v1).
- **Format:** `<lowercase-uuid>/<file>.rtf=<sha1hex>`, `\n`-joined, **no trailing
  newline**. UUIDs in the checksum are **lowercase** even though the `Data/`
  directories are **uppercase** — mind the case when mapping entries to files.
- **BUG FIXED:** `STRIP_ON_EXPORT` used bare names (`'docs.checksum'`,
  `'search.indexes'`…) but the real root-relative paths are `Files/Data/
  docs.checksum`, `Files/search.indexes`, `Files/binder.autosave`,
  `Files/binder.backup`. The strip had been a **silent no-op** — Gate 0 actually
  passed while exporting the *stale* caches unchanged, which independently
  confirms a stale/absent checksum still opens clean. Paths corrected;
  search/binder caches now genuinely stripped (Scrivener rebuilds), docs.checksum
  regenerated. The fixture (`fixture.ts`) also had these at the wrong paths — fixed.
- Coverage: `sha1.test.ts` (vectors + padding boundaries), `checksum.test.ts`
  (byte-parity oracle vs `example.scriv`; format; real-project end-to-end that
  confirms the three stale `example_v1` hashes are repaired on export).

### FEATURE — title editing / rename (2026-07, third mutation path)

Testing surfaced that titles couldn't be edited: the editor header was a static
heading and there was no rename mutation (only add-time titling). Added rename as
the third first-class mutation alongside edit-text and add-doc:
- `scrivx.ts`: parser records each node's `<Title>` inner-text span
  (`titleTextStart/End`) + `openTagEnd`; `setBinderItemTitle` splices just that
  span (minimal-diff, entity-encoded), inserting a `<Title>` if absent.
- `session.ts`: `renameItem(uuid, title)` — documents and folders; marks dirty.
- `EditorPane.tsx`: title is an editable input that's part of the editor draft.
  The unified **Save** button commits whatever is pending — retitle, body edit,
  or both (Enter in the title also saves; Esc reverts). Folders are renamable
  too. Title does NOT auto-commit on blur, so an unsaved title is discarded on
  doc switch, same as unsaved body text.
- Manual **Gate 5 (rename)** pending: rename a doc + folder → export → open in
  Scrivener, both titles present, nothing else changed. Not updating the item's
  `Modified` attr on rename (project-level meta is freshened on export); Gate 5
  will confirm Scrivener tolerates the stale per-item mod date.

### FEATURE — auto-save (Tier 1 + Tier 2, 2026-07)

Scrivener-style auto-save, split by what "save" means here:
- **Tier 1 (commit draft → session):** `EditorPane` auto-commits 2s after the
  last edit, and on blur (leaving the title/body field). Manual Save still works.
  Cheap/memory-only; each commit self-validates (re-parse), so no silent corruption.
- **Tier 2 (persist session → IndexedDB):** `recovery.ts` persists the whole
  working session (via `session.serialize()`) to browser IndexedDB — a local
  crash/close safety net, NOT the `.scriv` (that's still explicit Export/folder-
  save). Debounced on mutation + flushed on `visibilitychange:hidden`. On open,
  `OpenScreen` offers "Continue where you left off". Close now persists and keeps
  the recovery record (no more "discard unsaved?" prompt — nothing is lost).
- **Save-on-close:** done via continuous persist + hidden-flush + `beforeunload`
  warning if dirty — NOT a single teardown-time write (browsers can't finish an
  async write during unload). On Android later, hook the flush to Capacitor App
  `pause`.
- **Tier 3 (auto-write to file/Dropbox) deliberately NOT done** — dangerous on a
  timer (Scrivener-open conflicts; Dropbox partial-write/divergence). Dropbox
  sync must be debounced + conflict-aware (DG-series), never a blind 2s timer.

### GATE 0 — PASSED (2026-07-01, desktop Scrivener 3, macOS)

Null round-trip of `example_v1.scriv` (opened via the **zip** path; see the
opener bug below): imported → exported copy with zero edits → unzipped → opened
in desktop Scrivener 3. **Clean open, no error or repair dialog, nothing
missing.** This validates the whole minimal-diff foundation at once:
- cache strip-and-rebuild works — `docs.checksum`, `search.indexes`,
  `binder.autosave`, `binder.backup` were removed on export and Scrivener
  regenerated them silently, no complaint;
- byte-preservation holds — all RTF, `.scrivx`, `version.txt`, styles, settings
  survived intact;
- the real **comment survived** — `content.comments` sidecar + the
  `{\field…scrivcmt://…\fldrslt…}` anchor round-tripped, confirming the generic
  `\*`-skip + file-map passthrough preserves comments (read-fidelity of the
  `\fldrslt` text also held — "Screenshot attached." showed as plain text, not a URL).

Gate 0 is the make-or-break gate. It passed. Mutation gates (2/3/4) and image
Gate 0b are now unblocked.

### FINDING — Research folder structure understood; non-text research items are NOT

`example_v1.scriv`'s Research folder is **empty**, so only the *structure* is
verified. From the code:
- `ResearchFolder` is a recognized folder type (`BinderTree.tsx`), the `.scrivx`
  parser reads all `BinderItem` types generically, and a **text** doc in Research
  behaves like any other (`content.rtf`). Structure renders and round-trips.
- **Untested / unhandled:** Research is where Scrivener stores imported non-text
  files (images, PDF, web archives, media) as `Files/Data/<uuid>/content.<ext>`,
  NOT `content.rtf`. The session layer hardcodes `content.rtf`
  (`session.ts:105,109`), so a non-text research item would be **preserved
  byte-for-byte on export** but **not readable/displayable/editable** (shows as
  an empty title-only item). Needs a fixture with an imported image + PDF in
  Research to verify preservation and to scope display support (ties into
  `image-support-roadmap.md` Tier 2).

### KNOWN ISSUE — macOS ".scriv project folder" open is a dead end

The "Open a .scriv project folder" button uses a directory picker
(`showDirectoryPicker` / `webkitdirectory`). On macOS a `.scriv` is a **package**,
which such pickers render as a grayed-out, unselectable file — so a Mac user can
never open their project via the folder button. Workaround: zip the `.scriv` and
use "Open a zipped project (.zip)". Fix later (guide users to zip, or detect and
message). The Android app is immune (Scrivener projects are plain folders there).
