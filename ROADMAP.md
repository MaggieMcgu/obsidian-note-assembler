# Cairn — Roadmap

## Done (v0.2.0)

- Pull in notes via fuzzy search
- Drag-and-drop + arrow button reordering
- Click section card to jump in editor
- Extract-back (section → standalone note, choose folder)
- Related Notes panel (follows wikilinks in content)
- Word count (total + per-section)
- Clean export (clipboard, wikilinks stripped)
- Source folder filter
- "New Essay" argumentative prompt
- Settings tab

## Done (v0.3.0)

- **Distill Highlight** — Select quote → modal → atomic note with Reference section. Parses Readwise metadata and highlight links
- **Add Quote to Essay** — Right-click selected text to insert as blockquote with attribution
- **Browsing workflow** — Open Essay button, sidebar stays open while navigating source notes
- **"Add to essay" toggle** in Distill modal — creates note AND adds it to the active essay
- **Right-click context menu** — "Add quote to essay" + "Distill highlight to note"
- **Structural heading styling** — H2s in project file get accent border + muted color
- **Export heading toggle** — Option to strip `##` lines from exported essay
- Source folder picker moved into Add Note dialog
- Renamed "Copy Clean" → "Export Final Essay"
- Settings: distill default folder, backlink-to-source, export headings toggle

## Next (v0.3.x polish)

- [ ] **Better quote headings** — Use `## Quote from [Source]` instead of truncating quote text into heading
- [ ] **Preview in fuzzy search** — Show 1-2 line snippet below each note name in the search modal

## v0.4 — Nested Sections + Source Queue

The big architectural shift. Driven by thinking through the CODE (Capture, Organize, Distill, Express) workflow and how Cairn serves the Express stage.

### The insight

Cairn currently treats Express as assembly: arrange note blocks, export. But real Express is: outline → reference notes → write original prose. Notes should *inform* the writing, not *become* the writing. And two workflows need support:

**Workflow A — "I have distilled notes, time to write":** Outline sections → drag notes into sections → write around them → export.

**Workflow B — "I have raw sources, need to think through them":** Seed sources → read each → distill on the fly into sections → rearrange → write → export.

Both workflows use the same architecture.

### Nested sections

`##` headings become essay structure (containers). `###` or content blocks become items within sections. The sidebar becomes two-level: sections you can reorder, items you can drag between sections.

**File format:**
```markdown
## The Problem
### Note Title A
[distilled content]
### My observation
[original writing]

## The Shift
### Note Title B
[distilled content]
```

### Source queue

Sources section flips from output (backlinks that accumulate) to input (a curated reading queue you seed first). Pick 3-5 source documents at project start. Browse them one by one, distilling as you go. Processed sources get marked/faded. Visual progress: "3 of 5 sources processed."

### What changes

- Parser: handle `##` (sections) and `###` (items within) as hierarchy
- Sidebar: two-level list — sections as containers, items as draggable children
- Drag model: drag items between sections, drag sections to reorder
- "Add note" lands inside a section, not as a new peer section
- Sources: seeded up front, checkable, browsable

### Open questions

- Should Sources live in the file (markdown-native, portable) or plugin data (cleaner file, more flexibility)?
- How does "add note to section" work in the UI? Drop target per section? Context menu?
- What's the right visual treatment for the two-level sidebar?

## Someday

- [ ] **Section merge** — Combine two adjacent sections into one
- [ ] **Backlink-aware suggestions** — Surface notes that link TO your included notes, not just FROM them
- [ ] **Tag/graph suggestions** — Suggest notes that share tags or graph proximity with included content
- [ ] **Export to file** — Write clean export to a new file instead of clipboard
- [ ] **Note preview pane** — View a note alongside the essay without pulling it into the file (reference mode)
