# Phase 1 Handoff: Edit Integration & Dropbox Sync

**For:** Claude Code
**Depends on:** Phase 0 (`phase0-handoff-scriv-roundtrip-spike.md`) — Gates 0–4 cleared, RTF run-map and minimal-diff splice proven.
**Type:** Rust core library extension, still mostly headless. UI is the consumer, not the subject.
**Why this exists:** Phase 0 proves *surgical* edits (find/replace) round-trip cleanly. Phase 1 proves the two things the actual product needs: (A) an **arbitrary rich-text edit** made in an editor can be written back to Scrivener RTF without fidelity loss, and (B) those edits can **sync through Dropbox to iOS Scrivener and back** without destroying data.

These are two different problems and must not be conflated:

- **Problem A — fidelity round-trip:** the user edited a document in *our* editor; we must serialize RTF back, preserving formatting we don't understand. No second editor is involved. This is a **serialization** problem.
- **Problem B — sync conflict:** the same document was edited on iOS Scrivener *and* our app between syncs, so Dropbox holds two divergent versions. This is a **merge** problem.

Diff tooling helps both, but differently. Solve A first; B depends on a trustworthy text projection from A.

---

## 1. Objective

Extend the Phase 0 Rust core so that:
1. An arbitrary edited document body (text + a small set of understood formatting attributes) writes back to `content.rtf`, preserving all untouched formatting byte-for-byte.
2. A project edited by our core and pushed to Dropbox reopens cleanly in **iOS Scrivener**, and a project edited in iOS Scrivener syncs back into our core, with divergence **detected and never silently overwritten**.

The Rust core is **not throwaway**. It is the kernel of the eventual Android app's document engine (Android primary, iOS a nice-to-have after), exposed to the GUI via **UniFFI (uniffi-rs)**. Code accordingly, and follow the boundary contract in `architecture-frontend-boundary.md` — the three-layer shape, the data-not-output rule, and **Gate A (thin-client boundary)** apply to every operation added in this phase.

---

## 2. Problem A: arbitrary rich-text round-trip

### 2.1 Document model — understood islands in an opaque sea

Parse `content.rtf` once into:
- **Understood text runs:** each a `(text, attributes)` pair, where `attributes` is a *small, closed* set we actually render — bold, italic, underline, paragraph/heading style, alignment. Start minimal; grow only as gates demand.
- **Opaque spans:** everything else (font tables, color tables, stylesheet, info group, unrecognized control words) preserved **verbatim** and anchored by original byte offset.

The concatenation of understood-run text is the **plain-text projection** — the same projection Phase 0 already builds. The editor edits the understood model. On save, untouched regions re-emit their original bytes; only changed runs are regenerated.

### 2.2 The save path: diff-driven span re-injection

1. Diff the **original projection** against the **editor's new text** to get a minimal edit script (insert/delete/replace at character offsets).
2. Map each edit back to the raw byte span(s) of the run(s) it touches.
3. Splice the RTF-escaped replacement into a **copy** of the original raw bytes (the Phase 0 splice technique, now driven by a diff instead of `--find`/`--replace`).
4. Validate the output re-parses under `rtf-parser` and the projection reflects the change.

**Diff on the projection, never on raw RTF bytes.** Diffing raw RTF interleaves control words into the comparison and produces corrupt splices. This is non-negotiable.

### 2.3 Diff libraries (all permissive — confirm exact license, none GPL)

- **`similar`** (mitsuhiko) — default choice. Myers/Patience/LCS, grapheme- and word-aware, clean change-tag API.
- **`dissimilar`** (dtolnay) — tight char-level Myers port of diff-match-patch; use for fine-grained character diffs.
- **`diff-match-patch`** (Neil Fraser / Google, Apache-2.0; Rust ports `dmp` / `diff_match_patch`) — built for syncing plain text across clients with semantic cleanup and patch/apply. Relevant to both A and B.

### 2.4 The hard 20%: newly-applied formatting

Text changes inside an existing run are the easy case. The hard case is the user **applying new formatting** (bolding a word that wasn't bold), which requires splitting a run and injecting control words.

**Rule: never invent RTF. Copy the exact control-word patterns Scrivener used in the fixture** (e.g. its precise `\b … \b0` / style-application form). Learn the dialect empirically from real `content.rtf`, the same way Phase 0 learns the header.

### 2.5 What we are NOT doing in Phase 1

No rich-text **CRDT** (`yrs`, `automerge`). They support formatting marks and true concurrent editing, but a CRDT wants to **own the whole document model**, which fights the "preserve the bytes you don't understand" principle that keeps this safe. They are the *eventual* path only if real-time collaboration is ever a goal — flagged here, deliberately deferred.

---

## 3. Problem B: Dropbox sync & conflict handling

### 3.1 What Scrivener itself does (precedent we should match)

Scrivener **never auto-merges**. On a Dropbox sync conflict it creates a **conflict copy** — it imports the diverged version as a *separate document in the binder* and lets the user reconcile by reading both. Being conservative is therefore the **native, user-expected** behavior, not a compromise. We are allowed to not solve auto-merge.

### 3.2 The base-version requirement (the crux of safe sync)

"Which version is latest" **cannot** be answered from file mtimes across devices and Dropbox — they are unreliable. Safe sync needs a **3-way** picture per document:

- `base` = the document content at the last successful sync (**we must persist this snapshot**).
- `mine` = our edited content.
- `theirs` = what is now on Dropbox.

Resolution:
- `theirs == base` → push `mine`.
- `mine == base` → fast-forward to `theirs`.
- both diverged → **conflict** (section 3.4).

Track a **monotonic per-device version** (a small version vector) per document. After the user resolves a conflict, that resolved content becomes the new `base` with an incremented version; it now dominates and re-syncs cleanly. **Never trust timestamps for precedence.**

### 3.3 iOS Scrivener is a first-class validation target

iOS Scrivener (via Dropbox) is half the audience and historically the **strictest, most fragile** consumer of these projects. Validation gates here must include a real **edit → Dropbox → open in iOS Scrivener** loop, and the reverse (**iOS edit → Dropbox → ingest in our core**). Desktop-only validation is insufficient for Phase 1.

Watch specifically: deleting `docs.checksum` (Phase 0's cache-strip hypothesis) on a *synced* project may make Scrivener treat every document as externally changed and trigger conflict resolution. Re-test the cache strategy under sync, not just under local open. Record behavior in `NOTES.md`.

### 3.4 Conflict handling — conservative first, auto-merge later

**Phase 1 stance: detect divergence, never silently overwrite.** Do not auto-merge initially.

1. Track `base` per document (section 3.2).
2. On divergence, **preserve both** — push our version as a new **conflict-copy `BinderItem`** rather than overwriting `theirs`. This mirrors Scrivener exactly and makes data loss nearly impossible.
3. **Snapshot before writing.** Take a Scrivener **Snapshot** of the document before any risky write or merge — native in-Scrivener undo, cheap once the snapshot files are understood.

**Deferred to Phase 2 (auto-merge):** when the projection is trusted, offer 3-way text merge with user-resolvable conflict markers:
- **`diffy`** has a `merge` producing `<<<<<<< / ======= / >>>>>>>` markers — a direct fit for "areas of conflict have text around them for the user to resolve." Inject markers as literal RTF text runs so they surface as editable text in Scrivener.
- Two cautions: (a) inline markers **cannot express a formatting conflict** (two different bolds aren't representable as text), and a half-cleaned marker writes garbage back — so offer inline merge **only for clean text-only conflicts** and fall back to conflict-copy otherwise; (b) "user-resolved latest" must come from the version vector (section 3.2), not file order.

---

## 4. Verification gates (Phase 1)

Each ends in a manual check. Run in order; iterate via `NOTES.md` on any failure.

- **Gate 5, Arbitrary text edit.** Replace a full paragraph and insert a new one in the editor model; write back. **Pass:** opens clean in desktop *and* iOS Scrivener; changed text correct; all untouched formatting byte-identical.
- **Gate 6, Applied formatting.** Bold a previously-unformatted word and change a paragraph to a heading. **Pass:** formatting renders correctly in Scrivener; surrounding runs intact; output re-parses.
- **Gate 7, Dropbox round-trip (no conflict).** Edit → Dropbox → open in iOS Scrivener; then edit in iOS Scrivener → Dropbox → ingest in core. **Pass:** both directions clean; `base`/version tracking correct; cache strategy survives sync.
- **Gate 8, Divergence detection.** Edit the same doc in both our core and iOS Scrivener before syncing. **Pass:** divergence detected; **both versions preserved** (conflict copy in binder); nothing silently overwritten; snapshot taken.
- **Gate 9 (Phase 2 preview, optional), Auto-merge.** Non-overlapping text edits on both sides. **Pass:** clean 3-way merge; overlapping edits produce user-resolvable markers; resolved version re-syncs and dominates.

---

## 5. Deliverables

1. Extended Rust core: document model (understood runs + opaque spans), diff-driven save path, RTF formatting-application emitter learned from fixtures.
2. Sync module: `base` snapshot store, per-document version vector, divergence detection, conflict-copy creation, Scrivener Snapshot writer.
3. Dropbox round-trip fixtures, including projects that have been through an **iOS Scrivener sync**.
4. Updated regression harness asserting: projection-diff correctness, byte-identity of untouched regions, divergence detection, no-silent-overwrite invariant.
5. `NOTES.md` additions: RTF formatting-application dialect, cache behavior under sync, iOS Scrivener complaints and resolutions, conflict-copy mechanics.
6. UniFFI/JNI boundary sketch for the Android app to consume the core.

---

## 6. Do this first (ordered)

1. Build the understood-runs + opaque-spans document model on top of the Phase 0 run-map.
2. Implement the diff-driven save path (`similar`) and clear **Gate 5** before touching formatting.
3. Implement formatting-application from fixture-learned control words; clear **Gate 6**.
4. Stand up the Dropbox round-trip and clear **Gate 7** — confirm the cache strategy survives sync.
5. Implement `base` tracking + version vector + conflict-copy, clear **Gate 8** (divergence, never overwrite).
6. Only then, if pursued, attempt the Phase 2 auto-merge preview (Gate 9).

---

## 7. Out of scope for Phase 1

No real-time collaboration / CRDT. No images, embedded binary, footnotes, comments (beyond preserving them as opaque spans). No compile. No auto-merge beyond the optional Gate 9 preview. UI polish belongs to the app phase, not the core.
