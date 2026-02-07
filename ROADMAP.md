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

## Next

- [ ] **Preview in fuzzy search** — Show 1-2 line snippet below each note name in the search modal so you can tell similar notes apart
- [ ] **Sources as frontmatter option** — Move source tracking to YAML frontmatter instead of visible `## Sources` section
- [ ] **Nest notes as h3 children** — Pull a note into an existing section as supplementary material (`### ` heading) rather than a peer `## ` section

## Someday

- [ ] **Section merge** — Combine two adjacent sections into one
- [ ] **Backlink-aware suggestions** — Surface notes that link TO your included notes, not just FROM them
- [ ] **Tag/graph suggestions** — Suggest notes that share tags or graph proximity with included content
- [ ] **Export to file** — Write clean export to a new file instead of clipboard
- [ ] **Multiple pinned sections** — Support pinning sections other than Sources (e.g., Bibliography, Notes)
