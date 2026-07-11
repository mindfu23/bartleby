# Android v1 Plan: Dropbox-Backed Scrivener Editing

**For:** Claude Code
**Depends on:** Phase 0 (format round-trip, Gate 0 PASSED), Phase 1 Problem B (sync/conflict design in `phase1-handoff-edit-integration-and-sync.md`), the boundary contract in `architecture-frontend-boundary.md`.
**Scope decision (user, 2026-07):**
- **Android v1 REQUIRES Dropbox** — read a `.scriv` from Dropbox and write changes back. No local/SAF file access in v1 (Dropbox *is* the storage), which removes an entire adapter.
- **Verification target for v1 is Dropbox + Mac Scrivener.** A Windows VM is available but not needed initially.
- **Rich-text formatting is deferred to Phase 2** (Phase 1 Problem A). v1 editing stays plain-text (formatting *outside* edits is preserved byte-for-byte).

---

## 1. The make-or-break: "Dropbox Gate 0" (headless, Mac-verified)

Before any Android or UI work, prove the scariest unknown the same way Phase 0 proved the format: **headless first.**

> Does a `.scriv` downloaded from Dropbox via the **API**, run through the existing session, and **uploaded back via the API**, reopen cleanly in **Mac Scrivener** (after the Dropbox desktop client syncs the folder down)?

This is different from the local Gate 0 because the write path is now the Dropbox HTTP API, not a local folder. Mac Scrivener relies on the Dropbox *desktop client* to pull changes; the Android app (and this spike) are Dropbox *API* clients. That asymmetry is the whole risk.

**Spike (Node/TS script, reusing `src/core` + `src/app/session.ts` unchanged):**
1. Dropbox OAuth (PKCE), list + download a real `.scriv` folder into a `path→bytes` Map.
2. `ProjectSession.open(map)` → null round-trip (zero edits) → upload back.
3. Wait for the Dropbox desktop client to show "up to date," open in Mac Scrivener.
4. **Pass:** clean open, no repair dialog, nothing missing — exactly the Gate 0 bar, now over Dropbox.
5. Then repeat with an edit and an add (DG1/DG2 below).

If this fails, it's a months-saving finding before Android exists. Record everything in `NOTES.md`.

---

## 2. Dropbox as a storage adapter (mirrors `fsio.ts`)

The core/session take a `path→bytes` Map and are storage-agnostic — that is the entire point of the layering. Dropbox is just a third adapter next to `fsio.ts` (File System Access) and `zipio.ts` (zip):

- `dropboxio.ts` (app layer): `listProject()`, `downloadProject() → Map`, `uploadDelta(writes, deletes)`. Same shape as `fsio.ts`'s `pickProjectDirectory` / `writeProjectDelta`.
- **Core and `session.ts` must not change** to support Dropbox. If they do, the boundary leaked — stop and fix per `architecture-frontend-boundary.md` §3.
- The headless spike (§1) and the Android app share this exact adapter. The spike is not throwaway.

---

## 3. Write safety over Dropbox (atomicity is the corruption risk)

Uploading files one-by-one leaves a window where the project is half-synced. Mitigations:

- **Upload order: content first, `.scrivx` second, `docs.checksum` last.** An interrupted sync then leaves the *old* binder plus some extra unreferenced doc bytes (harmless) rather than a new binder pointing at docs that haven't uploaded (broken).
- **Prefer Dropbox `upload_session/finish_batch`** to commit all changed files in one call, shrinking the half-synced window to near-zero.
- Regenerate `docs.checksum` over the exact uploaded bytes (already implemented, `checksum.ts`).
- **Never mutate the input** — keep the download as a restorable baseline (mirrors the local backup-zip behavior).
- Human factor to document: on Mac, the Dropbox desktop client must finish pulling before Scrivener is opened. The app can't control that; testing waits for "up to date."

---

## 4. Conflict handling (Phase 1 Problem B, now a v1 requirement)

Two devices (Android + Mac/iOS Scrivener) can edit between syncs. Per Phase 1 Problem B — do **not** silently overwrite:

- Track a **base version** per document (the last-synced content) so divergence is a 3-way question, not a timestamp guess.
- On divergence, **preserve both**: write the Android version as a **conflict-copy `BinderItem`** rather than overwriting the Dropbox copy — mirroring what Scrivener itself does. This is the v1 bar; auto-merge (diff3) stays Phase 2.
- Dropbox also creates its own "conflicted copy" files on concurrent writes — detect and surface these rather than fighting them.
- **DG3 test:** edit the same doc in Mac Scrivener and the app before syncing → both versions survive, nothing lost.

---

## 5. Dropbox app config & OAuth (flag early — a real release gate)

- **Scope:** the user's Scrivener files live in their general Dropbox, not an app-scoped folder, so the app needs **Full Dropbox access** (`files.content.read` + `files.content.write`), not the sandboxed "App folder" scope.
- **OAuth:** Authorization Code + **PKCE** (correct for a mobile/public client — no client secret on device). In Capacitor, drive it via the in-app browser + a deep-link/custom-scheme redirect.
- **⚠️ Production approval:** Dropbox caps **full-access** apps at a small user count (dev/testing is fine) until Dropbox grants **production approval**. This gates public Play Store distribution to many users — start that approval process early; it does not block personal testing.

---

## 6. Capacitor Android shell

- Add **Capacitor 7** (Node 20-compatible per the user's environment) wrapping the existing React UI. The web UI runs in the Android webview — literally the same frontend.
- Replace the OpenScreen's folder/zip buttons with **"Connect Dropbox"** → pick a `.scriv` from the account.
- Mobile-UX pass: the binder sidebar / editor need to feel right on a phone (some responsive scaffolding already exists in `App.tsx`).
- Performance watch (not a blocker): a full novel `.scriv` downloaded into in-memory Maps inside a webview — test with a real large project; optimize to lazy per-doc download later if needed.

---

## 7. Gate ladder for v1

Run in order; each ends in Mac Scrivener (via Dropbox desktop sync).

- **DG0, Dropbox null round-trip** (headless) — §1. Make-or-break.
- **DG1, Dropbox edit round-trip** (headless) — edit one doc, upload, clean open + change present.
- **DG2, Dropbox add round-trip** (headless) — add a doc, clean open, appears under the right folder.
- **DG3, Divergence** — concurrent Android+Mac edit → both preserved (conflict-copy), nothing lost.
- **DG4, On-device** — repeat DG0–DG2 from the actual Android app (Capacitor + `dropboxio.ts`).
- Then real-use soak on the user's own projects.

---

## 8. Deferred to Phase 2

- **Rich-text editing** (applied formatting / arbitrary round-trip — Phase 1 Problem A). v1 preserves untouched formatting byte-for-byte but writes edited text unformatted.
- Auto-merge (diff3) of conflicts; comment editing; image display/add; Research non-text; snapshots; Windows-Scrivener and iOS-Scrivener verification passes.

---

## 9. Do this first (ordered)

1. Finish local **Gates 2/3/4/0b** in desktop Scrivener — verify mutation paths before trusting them over Dropbox.
2. Register a Dropbox app (full access, PKCE); build `dropboxio.ts` + the headless spike.
3. Clear **DG0** against the user's real Dropbox + Mac Scrivener. Do not proceed until it passes.
4. DG1/DG2, then DG3 (conflict-copy).
5. Capacitor shell + Dropbox connect UI; clear **DG4** on-device.
6. Phase 2: rich text.
