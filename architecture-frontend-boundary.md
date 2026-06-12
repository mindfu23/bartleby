# Architecture & Frontend Boundary (shared, governs all phases)

**For:** Claude Code
**Applies to:** Phase 0 (`phase0-handoff-scriv-roundtrip-spike.md`), Phase 1 (`phase1-handoff-edit-integration-and-sync.md`), and every phase after.
**Why this exists:** Phases 0 and 1 are headless CLI work. The product goal is a GUI app — **Android primary, iOS a nice-to-have after** — that duplicates much of Scrivener's interface *and* functionality, with room for different UX designs. Whether that GUI is cheap to build is decided entirely by boundary discipline in the CLI phases. This document is the contract that keeps the core wrappable.

---

## 1. The governing principle

> **The CLI is not the application. The CLI is the first frontend. The CLI and the future Android/iOS GUI are thin clients over the same core engine — and the CLI must talk to that engine through the exact same public API the GUI will use.**

Hold this and the GUI is a second consumer, not a port.

---

## 2. The three-layer shape

```
┌─────────────────────────────────────────────┐
│  Frontends (thin: render + input only)       │
│   • scriv-cli  (Rust, clap)   ← Phase 0/1    │
│   • Android GUI (Kotlin/Compose via UniFFI)  │ ← primary, later
│   • iOS (Compose Multiplatform or SwiftUI)   │ ← nice-to-have
├─────────────────────────────────────────────┤
│  App-services layer  (stateful session)      │
│   open project · undo/redo stack · dirty     │
│   tracking · sync orchestration · conflict   │
│   state machine                              │
├─────────────────────────────────────────────┤
│  Core engine  (pure, no I/O opinions)        │
│   binder model · RTF run-map · edit splice   │
│   · projection/diff · format emitter         │
└─────────────────────────────────────────────┘
```

The **app-services layer** is the part CLI-first projects forget. It holds the application logic every frontend shares (so it isn't reimplemented per UI) while leaving all presentation in the frontend. It is what protects UX flexibility (section 5).

Crate split (suggested): `scriv-core` (pure engine), `scriv-app` (app-services / session), `scriv-ffi` (the UniFFI boundary crate), `scriv-cli` (thin CLI). Keep the FFI surface in its own crate so the engine never depends on binding concerns.

---

## 3. Two boundary rules that make or break GUI-wrapping

**Rule 1 — the core returns *data*, never *output*.**
`inspect` must not print a tree; it calls `core.binder_tree() -> BinderTree` (a structured value) and the CLI formats it. The GUI renders the same `BinderTree` as an outline. Enforced as: **the core crate contains zero `println!`/`eprintln!` and does not depend on `clap`.** If the core can't print, it is forced to expose proper return types, and the GUI gets them for free.

**Rule 2 — design the FFI-friendly API as *the* public API from day one, and let the CLI use it.**
UniFFI is happiest with owned, simple types: records/structs, enums, sequences, `Option`, string UUIDs, and callback interfaces. It rejects borrowed references, lifetimes, and complex generics across the boundary. Do **not** build a rich internal API for the CLI and bolt on an FFI veneer later — the veneer ends up re-modeling everything. Make the public API FFI-shaped now; the CLI consumes *that* and continuously proves the GUI's binding surface works.

---

## 4. The architecture gate (add to Phase 0 and Phase 1)

> **Gate A, Thin-client boundary.** Every CLI subcommand is a thin wrapper: parse args → call **one** public core/app function → format the result. No domain logic in command handlers; no reaching into core internals. **Pass:** removing the CLI crate would leave a complete, usable public API that a GUI could bind to unchanged.

If a subcommand needs to reach inside the core, the API is wrong — and Gate A surfaces it before the GUI does.

---

## 5. How UX flexibility is preserved: model, not view-model

The core must **not** decide how the binder is displayed (outline vs. corkboard vs. columns), what an editing screen looks like, navigation, selection, layout, or theming. It provides primitives — documents, runs with attributes, `apply_edit`, `snapshot`, conflict objects — and different UX designs compose them differently. A minimalist writing app and a full Scrivener-clone both call `apply_edit(uuid, …)` and `binder_tree()`; they differ only in the frontend.

**The sorting rule for what lives where:**

> If two different UIs would both need it **and implement it identically**, it belongs in the core/app-services layer (undo stack as data, dirty-state, the sync state machine — application logic, not presentation). If two UIs would implement it **differently**, it belongs in the frontend (how undo is surfaced, what a conflict dialog looks like).

That is the whole reason the app-services layer exists: it pulls reusable application logic *down* out of the frontends so every UI shares it, while everything presentational stays *up* in the frontend where design freedom lives.

**Forward hook (do not build yet, do not foreclose):** a GUI must *react* to changes (re-render on edit, show sync progress, surface a conflict). Phase 0/1 may use a simple pull model (call, then re-query). Design the API so a **callback/observer** can be added later without reshaping it — UniFFI callback interfaces let Rust notify Kotlin/Swift asynchronously (e.g. "sync found a conflict").

---

## 6. Reference architecture & tooling

This is a proven path, not a novel one:
- **matrix-rust-sdk** — the canonical example: a pure Rust core + a separate FFI crate + UniFFI bindings driving native iOS and Android UIs over a shared engine. Firefox uses the same pattern.
- **Tooling:** `cargo-ndk` compiles the core to Android `.so` per ABI (target `arm64-v8a` first); **UniFFI** generates the Kotlin (and Swift) bindings.

---

## 7. Platform & binding decision (Android primary, iOS nice-to-have)

The core stays UI-agnostic, so none of this must be decided to start Phase 0. Recorded so the frontend phase inherits the intent:

- **Core reuse is free on both platforms.** UniFFI generates **Kotlin** *and* **Swift** bindings as first-class targets. The Rust engine ports to iOS with no rework.
- **Android (primary):** **Kotlin + Jetpack Compose** over the core via UniFFI. Best-supported native path; Compose gives a Scrivener-like native UI.
- **iOS (nice-to-have, after Android):** two routes, both reusing the same Rust core —
  - **Compose Multiplatform** (JetBrains; iOS support stable since 2025) extends most of the Compose UI to iOS. Pick this from the start *if* UI-sharing with iOS is wanted.
  - **SwiftUI rebuild** over the same core (via UniFFI-Swift) if Compose Multiplatform ever fights iOS. Only the view layer is rebuilt; the engine is shared.
- **Avoid for this project:** React + Capacitor (your usual web-app default). Wrapping a web UI around a Rust core means an awkward wasm/bridge boundary and a non-native feel, which fights "duplicate much of Scrivener's interface."

**Open decision for the frontend phase:** commit to **plain Jetpack Compose** (Android-only UI, iOS UI rebuilt later in SwiftUI) vs. **Compose Multiplatform** (shared UI to iOS from the start). Given Android-primary / iOS-later, either is fine; defer until the engine is proven.
