# Image Support Roadmap (shared, supersedes the text-only constraint)

**For:** Claude Code
**Applies to:** Phase 0, Phase 1, and the app phases.
**Status:** the earlier "text-only, no images/binary" rule is **lifted**. It was a spike-scoping decision, not a limit of the approach, and its original cause no longer applies (see below). Images are a supported goal: preserve them, display them, and add new ones that open cleanly in Mac + Windows Scrivener.

---

## 1. Why the constraint existed (and why it's gone)

The original ban (Phase 0 §6/§10/§14) had one real cause: the **Rust** plan validated RTF with the `rtf-parser` crate, which crashes on `\bin` binary and base64 images. That was a limitation of a *validation dependency*, not of the byte-splice approach. The project's actual core is **TypeScript with its own `buildRunMap`** (not `rtf-parser`), so that cause is gone. The secondary reason — keeping the make-or-break Gate 0 isolated from image complexity — is preserved by *sequencing* (text-only fixture first, images at Gate 0b), not by banning images from the product.

**How image bytes survive by construction:** images live inside `\pict` groups, which the projection **skips** (`pict` is in the core's skipped-groups list). The byte-splice carries those bytes through **untouched** — they are never parsed or rewritten. So preservation is a property of the architecture, not a feature to build.

---

## 2. The real Scrivener image dialect (from the `example.scriv` fixture)

Scrivener-Mac stores an embedded image as hex, wrapped for Word compatibility:

```
{\*\shppict{\pict {\*\nisusfilename NAME}\picwW\pichH\picwgoalGW\pichgoalGH\jpegblip FFD8FFE0...}}
```

Observed values: `\picw1048\pich1280\picwgoal20960\pichgoal25600\jpegblip` with hex JPEG data starting `ffd8ffe0…`.
- `\picw / \pich` = native size in **pixels**.
- `\picwgoal / \pichgoal` = display size in **twips**, at a **20:1** ratio to pixels (`20960 = 1048 × 20`, i.e. 72 dpi).
- `\jpegblip` = JPEG hex. PNG would be `\pngblip`.
- `{\*\shppict{…}}` = the ignorable Word-compat wrapper; `{\*\nisusfilename …}` names the image (ignorable destination).

This is standard cross-platform RTF that both Mac and Windows Scrivener read.

---

## 3. The three tiers

### Tier 1 — preserve images through edits (open + round-trip)
**Effort: ~free.** Already true by construction (§1). An edit elsewhere in a document leaves every `\pict` byte-identical. Covers "open Scrivener files that contain images, in document bodies and in notes."
**Validation:** Gate 0b (Phase 0) — round-trip `example.scriv` (which has real `\jpegblip` images) and confirm images intact on reopen in Scrivener.

### Tier 2 — display images in the editor
**Effort: moderate.** Decode the `\pict` hex → image blob → render.
- `\jpegblip` / `\pngblip` are ASCII hex — trivial to decode in JS/Android.
- **Hard edge:** Windows Scrivener can emit `\emfblip` / `\wmetafile` (EMF/WMF metafiles) that browsers can't render natively. Convert server-side, or show a "image (metafile)" placeholder while still **preserving** the bytes (Tier 1 keeps them safe regardless of whether Tier 2 can draw them).

### Tier 3 — add NEW images (Android → opens in Mac + Windows Scrivener)
**Effort: moderate.** Emit a `\pict` in the exact §2 dialect (clone the wrapper from a real file; never hand-author from memory):
- Emit **PNG** (`\pngblip`) — universally read by both Mac and Windows Scrivener. **Avoid metafiles** for cross-platform safety.
- Native size `\picwW\pichH` (pixels); display size `\picwgoal(W×20)\pichgoal(H×20)` (twips).
- Wrap in `{\*\shppict{\pict {\*\nisusfilename name}…\pngblip <hex>}}`.
- Splice the new `\pict` group into the RTF as an opaque run (same byte-splice machinery as text).
- **Regenerate `docs.checksum`** afterward (SHA-1 of the file bytes, lowercase-uuid path — see NOTES.md). Skipping this makes Scrivener flag the doc as externally changed on next open/sync.

---

## 4. The one genuine parser gotcha: `\binN`

The `example.*` fixtures use hex `\jpegblip` (safe: `\bin` count is zero across all of them). But `\binN` embeds **raw** bytes with a length prefix, and those bytes can contain `{`/`}` that break naive brace-matching. Before claiming "opens *any* Scrivener file," the run-map must handle `\binN` by reading exactly N bytes literally rather than scanning for braces. Not needed for the current fixtures; required for full generality.

---

## 5. Images inside comments

Gated on an independent open question: **Scrivener-3 comment storage is not yet located** (it is not an inline `Scrv_`/`annotation` token in the `example_v2-comments.scriv` fixture — see NOTES.md). Once comment storage is reverse-engineered, an image inside a comment is the same Tier-2/Tier-3 `\pict` technique applied in that location. Until then, comments (and any images within them) must survive as **opaque preserved bytes**, never rewritten.

---

## 6. Sequencing

1. **Gate 0** on `example_v1.scriv` (text-only) — make-or-break round-trip, images out of the picture.
2. **Gate 0b** on `example.scriv` (real `\jpegblip` images) — confirm Tier 1 preservation.
3. Tier 2 (display) and Tier 3 (add), in either order, once round-trip is trusted.
4. Comment storage research → images-in-comments last.
