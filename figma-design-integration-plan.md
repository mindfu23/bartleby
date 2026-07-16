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

## Recommended next step
Start with **Phase A (themes)** — it's what you asked for, it's self-contained, and it establishes the token layer everything else styles against. Then Phase B/C are the grounded, high-value structure; Phase D is the delightful real-data analytics; Phase E waits for the rich editor.
