# Cairn — Roadmap

## Done (v0.2.0)

- Pull in notes via fuzzy search
- Drag-and-drop + arrow button reordering
- Click section card to jump in editor
- Extract-back (section → standalone note, choose folder)
- Related Notes panel (follows wikilinks in content)
- Word count (total)
- Per-section word count
- Clean export (clipboard, wikilinks stripped)
- Source folder filter
- Auto-open project file
- "New Essay" argumentative prompt

## Next (v0.3)

- [ ] **Preview in fuzzy search** — Show 1-2 line snippet below each note name in the search modal so you can tell similar notes apart
- [ ] **Sources as frontmatter option** — Move source tracking to YAML frontmatter instead of visible `## Sources` section. Keeps provenance without cluttering the essay
- [ ] **Nest notes as h3 children** — Pull a note into an existing section as supplementary material (`### ` heading) rather than a peer `## ` section

## Someday

- [ ] **Section merge** — Combine two adjacent sections into one
- [ ] **Backlink-aware suggestions** — Surface notes that link TO your included notes, not just FROM them
- [ ] **Tag/graph suggestions** — Suggest notes that share tags or graph proximity with included content
- [ ] **Export to file** — Write clean export to a new file instead of clipboard
- [ ] **Multiple pinned sections** — Support pinning sections other than Sources (e.g., Bibliography, Notes)
