# Phase 0 Handoff: Headless Scrivener Round-Trip Spike

**For:** Claude Code
**Type:** Rust CLI spike, no UI, no networking
**Why this exists:** This is the de-risking spike for a larger project (an Android app that edits Scrivener projects and saves them back to the cloud). Before any app is built, we must prove one thing: a `.scriv` project can be modified programmatically and reopened cleanly in desktop Scrivener. If that works, the rest is engineering. If it does not, we find out in days, not months.

The real deliverable of this spike is **verified knowledge of the format's write rules**, captured in `NOTES.md`. The code is the means to that.

---

## 1. Objective

Build a headless Rust command-line tool that can open a real Scrivener 3 project, read its structure and text, edit existing document text, add a new document, and write the project back to a **new** location, such that desktop Scrivener reopens the output with no error and with all changes intact.

---

## 2. Definition of done

All five verification gates in section 11 pass by **manual inspection in desktop Scrivener**, and `NOTES.md` documents the format behavior discovered along the way. Gate 0 (null round-trip) is the make-or-break gate and must pass before any mutation feature is built.

---

## 2a. Architecture constraint (read first)

This spike is the first frontend over a reusable core, not a standalone tool. Before writing code, read `architecture-frontend-boundary.md` — it is the contract that keeps the core wrappable by the eventual Android/iOS GUI. In particular: the core returns **data, not printed output** (zero `println!` and no `clap` in the core crate), and **Gate A (thin-client boundary)** applies to every subcommand below.

---

## 3. Tech constraints

- Language: **Rust**, single binary CLI.
- RTF reading and validation: **`d0rianb/rtf-parser`** (MIT) as a dependency. Use it to extract plain text and to validate that output is still parseable RTF. It has no serializer, which is intentional and fine (see section 6).
- Suggested crates: `clap` (CLI), `quick-xml` (read and write `.scrivx`, structure-preserving), `uuid` (v4), plus std. Use your judgment, keep dependencies permissive (MIT/Apache).
- **GPL boundary, non-negotiable:** `dcfvg/scrivener-parser` (GPL-3.0) may be cloned and **read as a reference** to understand the format and the checksum/index logic. Do **not** copy or vendor its code. Reimplement clean. The downstream product may be proprietary, so this spike must stay free of GPL code.

---

## 4. The `.scriv` format (orientation, not gospel)

A `.scriv` is a **directory**, not a file. Scrivener 3 / File Format 2.0 layout, as understood from reverse-engineered sources:

```
MyProject.scriv/
  MyProject.scrivx          <- the binder, an XML file (root element observed as <ScrivenerProject>)
  Files/
    Data/
      <UUID>/
        content.rtf         <- one per text document, the editable body
  Settings/
  styles.xml
  search.indexes            <- search cache
  version.txt
  writing.history
  docs.checksum             <- used for external-change detection
  binder.autosave
  binder.backup
```

Binder XML shape (real sample, abbreviated):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject ... Version="2.0" Identifier="DF5DA7F0-..." Creator="SCRWIN-3.1.5.1"
                  Device="..." Modified="2025-03-14 22:15:28 -0600" ModID="B4A944C3-...">
  <Binder>
    <BinderItem UUID="17807D28-..." Type="DraftFolder" Created="2025-03-14 22:15:17 -0600"
                Modified="2025-03-14 22:15:17 -0600">
      <Title>Draft</Title>
      <MetaData>
        <IncludeInCompile>Yes</IncludeInCompile>
      </MetaData>
      <Children>
        <BinderItem UUID="921B4A08-..." Type="Text" Created="..." Modified="...">
          <Title>Scene One</Title>
          <MetaData> ... </MetaData>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>
```

Notes that matter:
- UUIDs are **uppercase with hyphens**.
- Timestamps are `YYYY-MM-DD HH:MM:SS ±HHMM` in local time.
- Older Scrivener (v1/2) used `Files/Docs/<n>.rtf` with numeric names. That is **not** this format. The fixture must be Scrivener 3.

**First task before coding:** inventory the actual fixture project on disk and treat that as ground truth. Where it differs from the description above, the fixture wins, and the difference goes in `NOTES.md`.

---

## 5. CLI design

Subcommands, each independently testable:

| Command | Purpose | Risk |
|---|---|---|
| `inspect <project.scriv>` | Print the binder tree: title, type, UUID, nesting. | Read-only |
| `read <project.scriv> <uuid>` | Print the plain-text projection of one document. | Read-only |
| `roundtrip <project.scriv> -o <out.scriv>` | Copy and write back with **zero** changes. | The Gate 0 test |
| `edit <project.scriv> <uuid> --find <s> --replace <s> -o <out.scriv>` | Minimal-diff text edit of one document. | Write |
| `add <project.scriv> --parent <uuid\|root> --title <s> --text <s> -o <out.scriv>` | Add a new text document. | Write |

Every mutating command writes to a **new** `-o` output directory and leaves the input untouched (see section 9).

---

## 6. The minimal-diff RTF rule (the crux)

This is the single most important constraint in the spike. Get it wrong and projects corrupt.

**Rule: the original `content.rtf` bytes are the source of truth. Never round-trip them through a full parse-and-reserialize.** `rtf-parser` is used only to (a) extract the plain-text projection and (b) validate that output still parses. The edit itself is a **byte-span splice** on the original bytes.

### Technique: build a text-span map in one pass over the raw RTF

Walk the raw bytes, tracking group depth, and classify each region as one of:
- group open `{` or close `}`
- a control word: `\` then ASCII letters, then an optional integer, then an optional single delimiting space
- a control symbol: `\` then one non-letter (this includes hex escapes `\'hh`)
- literal text

Mark a group as **non-editable** and skip its entire contents when it begins with `\*` (ignorable destination) or when its leading control word is one of `fonttbl`, `colortbl`, `stylesheet`, or `info`. Literal text **outside** those groups is renderable text.

For each renderable run, record `(raw_byte_start, raw_byte_len, decoded_text)`. Concatenating the decoded runs gives the plain-text projection that `read` prints and that `--find` searches.

### Applying an edit

1. Locate the target substring in the plain-text projection. Handle the case where it spans more than one run.
2. Map it back to the raw byte span(s) it occupies.
3. RTF-escape the replacement: escape `\`, `{`, `}`, and emit non-ASCII per the file's declared code page (`\'hh` for cp1252 bytes, or `\uN?` Unicode escapes). Match how the file already encodes such characters.
4. Splice the escaped replacement into a **copy** of the raw bytes. Everything else stays byte-identical, including the entire header.

### Validate every write

Re-run `rtf-parser` on the output. It must parse with no error, and its extracted text must reflect the change. If it fails to parse, the splice broke structure. Diagnose before moving on.

**Fixture constraint:** `rtf-parser` does not handle `\bin` binary or base64 images and can crash on them. Keep Phase 0 fixtures to simple text documents with no embedded images or binary.

---

## 7. Adding a document

1. Generate a UUID v4, formatted **uppercase with hyphens** to match Scrivener.
2. Create `Files/Data/<UUID>/` and write `content.rtf`. **Safest approach:** clone the RTF header from an existing `content.rtf` in the same project (guaranteeing a Scrivener-compatible font table and code page), then put the new body text after it, escaped. Do not hand-author a header from scratch if a real one can be copied.
3. Insert a `<BinderItem>` into the `.scrivx`, either at root under `<Binder>` or under a parent's `<Children>` (create `<Children>` if the parent has none):
   - attributes `UUID`, `Type="Text"`, `Created` and `Modified` set to now in the timestamp format from section 4.
   - a `<Title>` child.
   - a `<MetaData>` child. **Mirror the exact child structure of an existing sibling `Type="Text"` item** rather than trusting the abbreviated sample above. Empirical structure beats this spec.

XML may be reserialized in full (it is far more tolerant than RTF) as long as the output round-trips cleanly. Verify by reopening in Scrivener.

---

## 8. Checksum, index, and metadata handling (the known unknowns)

These behaviors are not documented in public sources and must be discovered empirically. Proceed in this order.

**Hypothesis to test first (cheapest):** after writing the output, **delete** `docs.checksum` and `search.indexes` (and optionally `binder.autosave`, `binder.backup`, `writing.history`), on the theory that Scrivener rebuilds these caches on open. Run Gate 0 with this approach.

**If Scrivener errors, repairs, or refuses to open:** study how `scrivener-parser` models these files (reference only, no copy), consult the Literature & Latte File Format Specification if it has been obtained, and regenerate them correctly. Record the exact behavior and resolution in `NOTES.md`.

**Root `ModID` and `Modified`:** on write, generate a fresh `ModID` UUID and set `Modified` to now. Test whether Scrivener cares about stale values. Log findings.

---

## 9. Write safety

Phase 0 **never mutates the input project.** For every mutating command:
1. Copy the entire input `.scriv` directory to the fresh `-o` output path.
2. Apply mutations in the output copy only.
3. Validate (re-parse RTF, check XML well-formedness).
4. Leave both input and output on disk.

Verification always opens the **output**. The input stays pristine as the baseline and as a diff target.

---

## 10. Test fixtures and regression harness

**Primary fixture:** author a fresh project in **desktop Scrivener 3** and commit it as `fixtures/baseline.scriv`. It should contain a couple of folders, several text documents with varied content (plain paragraphs, some bold and italic, a heading, accented characters such as é and ü to exercise escaping, and one empty document). No images, no embedded binary. Do **not** use `carsomyr/scrivener_starter` as a format fixture, it is old-format. It is useful only as a conceptual reference for which files are durable vs. regenerated.

**Regression harness** (`cargo test` or a shell script): run each subcommand against the fixture into temp outputs and assert the automatable invariants:
- output `content.rtf` re-parses under `rtf-parser`
- output `.scrivx` is well-formed XML
- the expected text change is present in the plain-text projection
- a new `BinderItem` exists at the expected path with the expected title and a matching `Files/Data/<UUID>/content.rtf`
- the input project is byte-unchanged after the run

The harness cannot assert "Scrivener accepts it." That stays manual (section 11).

---

## 11. Verification protocol (the gates)

Each gate ends in a **manual open in desktop Scrivener** (Mac or Windows). Run them in order.

- **Gate A, Thin-client boundary.** Defined in `architecture-frontend-boundary.md` §4. Every subcommand is a thin wrapper over one public core function, with no domain logic in the command handler. **Pass:** removing the CLI crate leaves a complete public API a GUI could bind to unchanged. Verify continuously, not just once.
- **Gate 0, Null round-trip.** `roundtrip baseline.scriv -o out0.scriv` with zero edits. Open `out0` in Scrivener. **Pass:** opens with no error or repair dialog, binder and all text identical to baseline. This is make-or-break. If it fails, read/copy/cache handling is wrong and nothing else proceeds.
- **Gate 1, Read fidelity.** `inspect` shows the correct binder tree and `read <uuid>` prints text matching what Scrivener shows, including accented characters. **Pass:** matches.
- **Gate 2, Edit.** `edit baseline.scriv <uuid> --find X --replace Y -o out2.scriv`. Open `out2`. **Pass:** opens clean, the target document shows Y where X was, its bold/italic/heading formatting intact, all other documents unchanged.
- **Gate 3, Add.** `add baseline.scriv --parent <folder-uuid> --title "Spike Test" --text "Hello from headless." -o out3.scriv`. Open `out3`. **Pass:** opens clean, "Spike Test" appears under the right folder with the right body, existing content untouched.
- **Gate 4, Combined.** An edit and an add in sequence. **Pass:** opens clean, both changes present.

**The iterate loop:** on any failure, record Scrivener's exact message and behavior in `NOTES.md`, form a hypothesis (RTF validity, XML, checksum, index, timestamp, or ModID), fix, and re-run from Gate 0.

---

## 12. Deliverables

1. A Rust CLI crate (suggested name `scriv-spike`), permissively licensed, depending only on `rtf-parser` plus permissive utility crates.
2. The five subcommands from section 5.
3. `fixtures/baseline.scriv` and any golden output projects.
4. The automated regression harness.
5. **`NOTES.md`**, the empirical record: actual on-disk structure observed, checksum and index behavior, every Scrivener complaint and its resolution, and any RTF or XML edge cases hit. This is the primary output of the spike.
6. `README.md` with run instructions and the manual verification protocol.

---

## 13. Do this first (ordered)

1. Clone `rtf-parser` (dependency) and `scrivener-parser` (read-only reference, no code copied).
2. Author `fixtures/baseline.scriv` in desktop Scrivener 3. Inventory its real on-disk structure and reconcile against section 4, logging differences in `NOTES.md`.
3. Build `inspect` and `read` first (read-only, lowest risk) and clear Gate 1.
4. Build `roundtrip` (copy, strip caches, write) and clear **Gate 0** before any mutation feature.
5. Build `edit` (minimal-diff) and clear Gate 2. Then `add` and clear Gate 3. Then Gate 4.

---

## 14. Out of scope for Phase 0

No Android, Flutter, or UI. No Dropbox, cloud, or GCS. No images, embedded binary, footnotes, comments, snapshots, or compile. No full RTF fidelity beyond preserve-untouched plus simple edits. No conflict detection. All of that belongs to later phases.

**Note on scope vs. the product goal:** Phase 0 proves *surgical* edits (find/replace) round-trip cleanly. It does **not** prove arbitrary rich-text round-trip or Dropbox/iOS sync — those are the two largest remaining product risks and are addressed in `phase1-handoff-edit-integration-and-sync.md`. Clearing Gate 4 means the format plumbing works, not that the product is de-risked.
