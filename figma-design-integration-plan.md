# Figma Design Integration Plan

**Source:** `figma-mocks/` (Figma-generated HTML/CSS/JS export, reviewed 2026-07-12).
**What it is:** a polished, branded **4-tab mobile app** for Bartleby with a theme system — a much richer vision than today's single-project editor.

## The mock in one glance

A phone app with bottom-nav tabs and 5 themes:

| Tab | Screen | Key elements |
|---|---|---|
| **Manuscripts** (home) | Library/dashboard | Brand header + "SYNCED WITH SCRIVENER", "LATEST BACKUP" card, **active manuscripts with progress rings** (words/target %), **recent activity** feed |
| **Outline** (per project) | Project overview | **Session target** (daily word goal, "158 words left"), **daily writing streak** (diamonds), **chapter outline** with **status badges** (DONE / DRAFTING / OUTLINE) |
| **Write** | Distraction-free editor | Serif manuscript text, session **word counter + timer**, formatting toolbar (B / I / …) |
| **Insights** | Analytics | Total written, daily average, **weekly cadence** bar chart, **milestones/achievements** |

**Theme system:** `data-theme` on `<html>` + CSS custom properties (`--color-*`). Ships 5 palettes — **light, dark, lavender, mint, coral** — plus a dev theme-switcher. Fonts: Big Shoulders Display (display), Manrope (body), Young Serif (serif).

## Feature → data source → feasibility

The critical question for each feature: *is it backed by real `.scriv` data, or invented?* Two on-disk findings settle most of it.

| Feature | Backed by | Feasibility |
|---|---|---|
| **Multi-manuscript home / library** | Dropbox `.scriv` listing (already built) + computed word counts | ✅ Grounded — extends what we have |
| **Per-project / chapter word counts** | Sum of `content.rtf` projections | ✅ Computed, real |
| **Progress % vs target** | Scrivener **project targets** (draft/session) OR a Bartleby-local target | ✅ Real (targets file needs a small reverse-eng) |
| **Chapter outline + status badges** | Scrivener **Status/Label** metadata (`<StatusSettings>`/`<LabelSettings>` + per-item IDs) — currently *preserved but not read/edited* | ✅ Real Scrivener data; a genuine parity feature |
| **Latest-backup / sync status** | Dropbox path + last-save time | ✅ Real |
| **Session target · daily streak · weekly cadence · total · daily average · recent activity** | **`writing.history`** — Scrivener's own per-day log: `<Day dwc="145" …>2026-07-01</Day>` (dwc = draft words that day) | ✅ **Real Scrivener data**, trivially parseable |
| **Milestones / achievements** | Derived from the above (gamification) | ◻ Optional, derived |
| **Writing formatting toolbar (B/I)** | Applied rich-text editing | ⏳ **Phase 2** (rich editor) — deferred by prior decision |
| **Theme selection** | Pure UI | ✅ Easy, user-requested |

**Takeaway:** the design is *not* mostly-fabricated dashboards. `writing.history` and Status/Label make the analytics, streaks, targets, and outline **real-data features**. Only the formatting toolbar (rich text) and achievements are deferred/optional.

## The one strategic decision

This design implies a **structural shift**: from a single-project editor (open one `.scriv` → edit) to a **multi-tab app with a home/library above the project** and a writing-analytics layer. That aligns cleanly with the Dropbox multi-project model (list → pick → edit) but it's a real expansion, not a skin. The phasing below lets us adopt it incrementally, highest-value + most-grounded first, with the **theme system as a self-contained first win**.

## Phased plan

### Phase A — Theme system (self-contained, user-requested) ✅ SHIPPED (2026-07-15)
Make the app **user-themeable** with a selectable palette set.
**Done:** token layer (`@theme` in `src/index.css` maps `--color-*` → runtime `--th-*`), 5 palettes (dark/light/lavender/mint/coral) as `[data-theme]` blocks, `src/app/theme.ts` (load/apply/persist via localStorage `bartleby-theme`, default dark), `ThemePicker.tsx` swatch row in the open screen + editor header, applied on startup in `main.tsx`. Every component refactored off hardcoded stone/amber to semantic tokens (0 remaining). Adding a theme = one `[data-theme]` block + one `THEMES` entry (data, not code). 94 tests pass; deployed to bartleby-scriv.netlify.app.
- Introduce a **CSS-variable design-token layer** (mirror the mock's `--color-*` tokens) and drive Tailwind from it, so components read theme tokens instead of hardcoded `stone`/`amber`.
- Port the mock's **5 palettes** (light, dark, lavender, mint, coral) and keep the set **extensible** — a theme is just a named token block, so adding "Desert Oasis"/"Citrus Bloom" etc. is data, not code.
- **Theme picker** in a Settings/appearance menu; **persist** the choice (localStorage; survives reload; carries into the Capacitor app).
- Optional: honor OS light/dark as the default.
- *Independent of everything below; ships value immediately.*

### Phase B — App shell + Home/library — 🟡 shell shipped (2026-07-15)
- Restructure to the **bottom-nav shell** (Manuscripts / Outline / Write / Insights) with the branded header.
- **Home** = the Dropbox project list (already built) rendered as manuscript cards with **word counts** and **progress rings**; "latest backup" from last-save state.
- The editor becomes the **Write** tab; the binder feeds **Outline**.

**Shipped this pass (mobile-first, low-risk slice):** bottom nav with **Home / Outline / Write / Insights** (mobile only, `md:hidden`); desktop keeps the two-pane binder+editor untouched so the tested save/Dropbox/comment flows are unchanged. Write=EditorPane (single mounted instance, draft survives tab switch), Outline=BinderTree full-width (tap a doc → jumps to Write), Insights=`InsightsPanel` with **real** counts (words/documents/folders/avg/longest doc) computed from the open session; streaks/history deferred to Phase D. **Settings** moved behind a ⚙ gear (top-right of header + open screen) → `SettingsDialog` holds the labeled theme picker. Home tab = close/return to library.
**Still to do for full Phase B:** manuscript-card **Home/library** (word counts + progress rings, recent projects), branded header polish, desktop access to Insights.

### Phase C — Outline + Status/Label + targets
- Read/edit Scrivener **Status** and **Label** per item → the **status badges** and outline. New `.scrivx` metadata read/write (mirrors how we did titles/comments).
- Per-doc/chapter **word counts**; project **progress vs target** (read Scrivener targets file, or a Bartleby-set target).

### Phase D — Writing analytics (real, from `writing.history`)
- Parse `writing.history` → **daily streak**, **weekly cadence**, **total/average**, **session target progress**, **recent activity**.
- Decide append-on-write: when Bartleby saves, update `writing.history` too (so streaks count Bartleby edits), or read-only for now.

### Phase E — Deferred / optional
- **Rich-text toolbar** (B/I/headings) ← Phase 2 rich editor (also unlocks inline comment highlight + images).
- **Milestones/achievements** — gamification derived from Phase D.

## Themes — how user selection works (the explicit ask)
- Each theme = a named set of CSS custom properties (`--color-bg`, `--color-accent`, …), exactly like `figma-mocks/css/variables.css`.
- A **Settings → Appearance** picker lists all themes (swatch + name); selecting one sets `data-theme` on the root and **persists** it.
- **Extensible by data**: adding a palette is adding a token block + a name — no component changes. So the "variety of themes" from Figma (and future ones) are all selectable, and the user could even define custom ones later.
- Works identically in the browser and the Capacitor Android app.

---

# Road to an alpha (agreed 2026-07-16)

**Alpha = the Android app, looking like the Figma.** The web build is the test rig, so "alpha" means Capacitor, not the Netlify page.

## Gate 0 — Capacitor wrap — ✅ **OAuth PASSED on the Android emulator (2026-07-16)**
Not a Figma phase; it was the make-or-break, same doctrine as DG0. **Signed into Dropbox from the emulator and reached files.** Remaining gate steps (edit → save → opens clean in Mac Scrivener) still to run on a device.

**Shipped:**
- **The blocker was real and is fixed:** `redirectUri()` would have returned `capacitor://localhost/`, which Dropbox rejects. Native now uses **`bartleby://auth`** (legal only under PKCE). It must stay in sync in **three places**: `NATIVE_REDIRECT` in `src/app/dropboxauth.ts`, the `<intent-filter>` in `android/app/src/main/AndroidManifest.xml`, and the **Dropbox App Console** Redirect URIs.
- **Native flow has no page reload.** `beginAuth()` opens the *system browser* (`@capacitor/browser`, so the user's existing Dropbox session applies); the code returns via deep link (`@capacitor/app` `appUrlOpen`) into the running app. That's why `DropboxDialog` subscribes to `subscribeAuth()` — nothing else would re-render it. `MainActivity` is `launchMode="singleTask"`, so the code arrives via `onNewIntent`.
- **Storage seam** (`src/app/storage.ts`): web → localStorage, native → Capacitor Preferences (app-private, unreachable by web XSS). Async, so `initAuth()` hydrates an in-memory cache before first render (`isConnected()` is called during render and must stay sync). ⚠️ App-private ≠ encrypted-at-rest; **Keystore-backed storage is still a follow-up**.
- Recovery flush also hooks Capacitor **`pause`** (Android can background without a reliable `visibilitychange`).
- APK builds: **4–5 MB**, `com.anideasmith.bartleby`. `npm run android:apk` / `android:run` / `android:open`.

**Environment gotchas (both baked into the npm scripts + CLAUDE.md):**
- **Capacitor 7 needs JDK 21**; this machine defaults to 17 → `invalid source release: 21`. The scripts pin **Android Studio's bundled JBR 21** (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`) — nothing to install.
- `ANDROID_HOME` is not exported in the shell; the scripts set `~/Library/Android/sdk`.

## Settled: NO local-Dropbox access on Android (researched 2026-07-16, don't revisit)
Asked whether the app should use a locally-installed Dropbox before going over the network. **It cannot, and it wouldn't help.**
- **Dropbox's Android app implements no `DocumentsProvider` and does not integrate with SAF** (Dropbox staff statement) — it doesn't even appear in Android's file picker.
- No local mirror: it **streams on demand**. Offline copies live in its **private cache, hidden from the OS**. Offline *folders* are a **paid** feature. Android 11+ blocks `Android/data/...` via SAF anyway.
- No folder-tree access, and a `.scriv` is a folder of dozens of files. **The HTTP API is the only door.**
- The real version of that instinct = **our own** offline cache (see Android backlog #4).

## Constraints found while planning (don't rediscover these)
- **Home-screen word counts / progress rings can't be computed without downloading every project.** Needs a **cached-stats store** (IndexedDB) written on open/save; show last-known values, `—` for never-opened. Otherwise the home screen downloads the user's whole Dropbox on launch.
- **Fonts must be self-hosted.** The mocks link the Google Fonts CDN (`Big Shoulders Display` / `Manrope` / `Young Serif`); a CDN link breaks offline and is wrong for a packaged app. All three are Google Fonts → licensing fine. **The app currently sets no font-family at all** — this is the single biggest reason it doesn't yet *look* like the Figma, and it's cheap.
- **Progress rings need a target.** Scrivener's targets storage still needs reverse-engineering → ship a **Bartleby-set target fallback** so the ring isn't blocked on it.
- **Status/Label would be the first new `.scrivx` write surface since comments** → needs a real-Scrivener gate test, same as Gate 5/6/7.

## Android polish backlog (from device testing, 2026-07-16)

**Shipped already:**
- **Cached project listing** (`src/app/browsecache.ts`) — reopening the picker shows the last-known list **instantly**, then refreshes behind it (stale-while-revalidate); remembers the folder, so no retyping `/ebooks`. Header shows `· from 5 min ago` / `· refreshing…`. **A failed background refresh deliberately keeps the cached list on screen** — being offline must not hide your projects.
- **"Check again"** on the Scrivener-lock banner — close it in Scrivener, tap, banner clears.

**To do, most valuable first:**
1. **Android back button — closest thing to a bug; do first.** Back almost certainly **quits the app** from any screen, mid-edit. Should: close a dialog → go Write→Outline → only exit at top level (confirm if dirty). Use `@capacitor/app` `backButton`.
2. **App icon + splash** — still the default Capacitor icon. Alpha necessity; per user convention the logo doubles as the home-screen icon.
3. **Status bar theming** — status bar is fixed while themes change the background (Parchment will look wrong). `@capacitor/status-bar`, driven from `applyTheme()`.
4. **Real offline support** — cache the *opened project* locally (reuse the IndexedDB recovery machinery) so it opens/edits with no connection; **queue the save** for reconnect. This is the honest version of the local-Dropbox idea above.
5. **Keyboard insets** — Android's keyboard will cover the editor's lower half. `@capacitor/keyboard` + padding.
6. **"Continue writing ___"** — remembering the last project is half of Phase B-rest's home screen anyway.

## Order
1. ~~**Gate 0 — Capacitor**~~ ✅ OAuth passed; finish the device gate (edit → save → Mac Scrivener clean).
2. **Android polish 1–3** (back button, icon/splash, status bar) — small, and #1 is near-bug.
3. **Phase D — writing.history analytics** — best value/effort in the plan: real data, **read-only** (no format-write risk), fills the currently-thin Insights tab.
4. **Typography + branded header** — cheap, highest visual payoff.
5. **Phase B-rest — Home/library cards** — needs the stats cache; D's parsing overlaps.
6. **Phase C — Status/Label + targets** — first new write surface; gate-tested.
7. **Android offline (backlog #4)**, then **Phase E** — post-alpha (rich editor is large; achievements cheap once D exists).

**Alpha = 1 + 2 + 3 + 4 + 5.** C is nice-to-have; E is not alpha.

## Pick up here (next session)
- **User action outstanding:** register **`bartleby://auth`** in the Dropbox App Console → Redirect URIs (alongside the two `https://` ones) if not already done — the emulator sign-in worked, so it likely is.
- **Then:** finish the device gate (edit → save → open in Mac Scrivener, expect no repair/conflict dialog), and start Android polish #1 (back button).
- **Deploy is `npx netlify deploy --prod --dir=dist --no-build`** — `--no-build` is mandatory (see CLAUDE.md); verify by fetching the live bundle, never by the CLI's success line.
- 125 tests passing; web live and byte-identical to the tested build.
