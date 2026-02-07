# Cairn v0.4 — Source Queue + Nested Sections

## The Problem

Cairn v0.3 dumps full notes into the essay file as blockquotes. This works for 3-5 tight, already-distilled notes. It falls apart with 10+ raw sources — the file becomes a wall of other people's words before you've written anything of your own.

The research found that practitioners who produce the best work **separate source material from their own writing**:
- Holiday's cards sit on the table, not in the Google Doc
- Doto's Notes File is a sandbox; chapter files contain only prose
- Matuschak reviews notes in one place, writes in another
- Forte assumes notes are already distilled before they enter composition

## The Solution: Source Queue

**The sidebar splits into two sections:**

```
┌─────────────────────────┐
│  📂 My Essay            │  ← project selector (existing)
├─────────────────────────┤
│  SOURCES (7)            │  ← new: collected notes queue
│  ┌─────────────────┐    │
│  │ Identity is fluid │   │  ← each source is browsable
│  │ Pressure freezes  │   │
│  │ Holiday on cards  │   │  ← click to preview in sidebar
│  │ Ahrens on slots   │   │
│  │ ...               │   │
│  └─────────────────┘    │
│                         │
│  [+ Add Source]         │  ← fuzzy search (existing flow)
├─────────────────────────┤
│  OUTLINE                │  ← existing: essay structure
│  ┌─────────────────┐    │
│  │ ## Introduction   │   │
│  │ ## The collision  │   │  ← drag to reorder (existing)
│  │ ## What emerges   │   │
│  │ ---               │   │
│  │ ## Sources        │   │  ← pinned (existing)
│  └─────────────────┘    │
│                         │
│  [Open Essay]           │  ← existing
│  [Export Final Essay]   │  ← existing
└─────────────────────────┘
```

### Source Queue Behavior

**Adding sources:**
- "Add Source" opens the existing fuzzy search modal
- Selected note goes into the Sources list, NOT into the essay file
- Sources are stored in plugin data (per-project), not in the markdown file
- Sources can also arrive via Flint (spark → add to essay) or Distill (highlight → add to essay)

**Browsing sources:**
- Click a source in the sidebar → preview panel expands below (scrollable, read-only)
- Or: click opens the note in the editor (existing Obsidian navigation)
- Source titles are clickable links to the original note

**Moving from Sources → Essay:**
**Whole-note actions** (from the source list item):

1. **Add as-is** — dumps full note as blockquote into the essay (current v0.3 behavior). For when the note is already atomic/distilled.

2. **Distill first** — opens Distill modal with the full note content. You write your thinking, a new distilled note is created, and THAT note gets added to the essay as a blockquote. Source stays in queue (you might distill multiple insights from one source).

**Selection actions** (from text selected in the sidebar preview):

When you select text in the source preview, two actions appear (right-click context menu or floating buttons):

3. **Distill selection** — opens Distill modal with just the selected passage as the quote. You write what it means to you, a distilled note is created and placed in the essay. The source stays in the queue.

4. **Quote selection** — the selected text goes directly into the essay as a blockquote, attributed to the source. No modal, instant. For when the quote speaks for itself and you'll write around it later.

Both selection actions target the currently active `##` section in the Outline (or append at the end if none is selected). The source's `## Sources` wikilink is added to the essay's pinned Sources section.

**After processing:**
- Sources that have been fully used get a checkmark / muted styling
- User can manually mark a source as "done" or remove it
- "Done" sources collapse/fade but stay visible (you might come back)

### Where Sources Live (Data Model)

```typescript
interface Project {
  id: string;
  name: string;
  filePath: string;
  sourceFolder: string;
  // NEW in v0.4:
  sources: ProjectSource[];
}

interface ProjectSource {
  notePath: string;       // vault-relative path to the source note
  addedAt: number;        // timestamp
  status: "unread" | "active" | "done";
}
```

Sources are stored in plugin data, not in the essay markdown file. The essay file only contains YOUR writing + refined material you've chosen to pull in.

The `## Sources` pinned section in the essay file continues to accumulate wikilinks as you pull material in — that's the bibliography/attribution trail.

## Nested Sections (v0.4 Part 2)

This is the "where formlessness becomes form" step (Doto's step 4).

**Current:** Every `##` heading is a flat section in the sidebar. No hierarchy.

**v0.4:** Two-level structure:
- `##` = essay structure (thematic containers / outline points)
- `###` = items within (pulled-in notes, quotes, original writing blocks)

```markdown
## The collision of ideas

### Identity is fluid
> [distilled blockquote from source]

[Your connective tissue — what this means for the argument]

### But pressure freezes it
> [distilled blockquote from source]

[Your thinking — how A and B relate]

## What emerges from the collision

### The third idea
[Original writing — the spark that A + B produced]
```

**Sidebar shows:**
```
▸ The collision of ideas (2)
    Identity is fluid
    But pressure freezes it
▸ What emerges (1)
    The third idea
---
  Sources
```

**Drag behavior:**
- Drag `##` sections to reorder the essay structure
- Drag `###` items between `##` sections (move a note from one thematic group to another)
- This IS the Doto "grouping under headings" step

**Adding content to a specific section:**
- Right-click a `##` heading in sidebar → "Add note here" or "Add blank item"
- Or: drag from Sources queue directly onto a `##` heading

## Integration Points

### Flint → Cairn
Already built. Spark notes can be added to essay projects via checkboxes. With v0.4, they'd go into the **Sources queue** instead of directly into the file. User then decides when/how to pull them into the essay.

### Facet (Distill) → Cairn
Already built. Multi-project checkboxes in Distill modal. With v0.4:
- If "Add to essay" is checked, the distilled note goes into the Sources queue
- OR: option to send it directly to a specific `##` section (if the user knows where it belongs)

### Source Preview → Essay (Selection Actions)
New in v0.4. You're browsing a source in the sidebar preview:
- **Select text → Distill** — opens Distill modal with the selected passage. Your distilled insight goes into the essay at the active section.
- **Select text → Quote** — selected passage goes directly into the essay as a blockquote. Instant, no modal.
These are the primary way content moves from sources into the essay. The whole-note "Add as-is" is the fallback for already-refined notes.

## Workflow Mapping (Research → Features)

| Practitioner Step | v0.4 Feature |
|---|---|
| Holiday: spread cards on table | Sources queue = the table. Browsable, rearrangeable, separate from the draft. |
| Holiday: arrange into structure | Drag from Sources → Outline sections |
| Ahrens: decide topic from clusters | (Future) Cluster detection: "you have 12 notes about X" |
| Ahrens: transfer to working surface | Add Source = transfer to working surface |
| Ahrens: translate to coherent prose | Essay file = only your prose + refined quotes |
| Forte: search Second Brain for packets | Sources queue = curated search results |
| Forte: distill before using | "Distill first" choice when moving source → essay |
| Matuschak: speculative outlines accumulate | Multi-project distill = essays accumulate sources over time |
| Matuschak: attach notes to outline points | Drag source → specific `##` section |
| Doto: Notes File sandbox | Sources queue = the sandbox (messy, low-pressure) |
| Doto: group under thematic headings | Nested sections: drag `###` items between `##` groups |
| Doto: feed insights back to Zettelkasten | Extract-back (existing) from essay → standalone note |

## Implementation Order

### Phase 1: Source Queue (sidebar split)
1. Add `sources: ProjectSource[]` to Project data model
2. Split sidebar into Sources section + Outline section
3. "Add Source" puts notes in queue (not in file)
4. Source preview panel (click to expand/read)
5. Three actions: "Add as-is" / "Distill first" / "Pull quote"
6. Source status tracking (unread → active → done)

### Phase 2: Nested Sections
7. Parse `##` and `###` from essay file as two-level structure
8. Two-level sidebar display (collapsible `##` with `###` children)
9. Drag `###` items between `##` sections
10. "Add note here" targets a specific `##` section
11. Drag from Sources queue onto a `##` heading

### Phase 3: Polish
12. Source count badges
13. Keyboard shortcuts (next source, distill, skip)
14. "What am I ready to write about?" — scan vault for note clusters (stretch goal)

## What Stays the Same

- Project file as markdown (source of truth for essay content)
- `loadData()`/`saveData()` for plugin state
- Drag-to-reorder for `##` sections
- Pinned Sources section at bottom of essay
- Export Final Essay
- Right-click context menu (Add quote, Distill highlight)
- Open Essay button
- All existing settings
- Blockquote pattern for pulled-in content

## The Pitch (Updated)

**v0.3:** "Compose essays from your notes — pull, arrange, extract, export."

**v0.4:** "Collect sources. Browse them. Distill the insights that matter. Write the essay that lives between the notes."
