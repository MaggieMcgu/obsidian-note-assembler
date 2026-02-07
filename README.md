# Cairn — Essay Composer

**Compose essays from your notes — pull, arrange, extract, export.**

Cairn bridges the gap between *thinking in notes* and *writing in prose*. If you use a Zettelkasten, evergreen notes, or any atomic note system, you've probably felt the friction of turning a web of linked ideas into a linear essay. This plugin makes that process feel natural.

## The Problem

You have 200 notes. You need to write an essay. The current options:

- **Copy-paste** — Tedious, loses connection to source notes
- **Embeds (`![[Note]]`)** — Read-only, can't edit the text
- **Longform plugin** — Built for novels with scenes/chapters, not for assembling ideas

Cairn takes a different approach: your essay is a normal markdown file. The plugin gives you a sidebar to pull notes in, rearrange them, and write — then extract new ideas back into your vault when they emerge.

## How It Works

**The full loop:** Read → Highlight (Readwise) → **Distill** (Cairn) → Note → **Essay** (Cairn)

1. **Read & highlight** — Capture highlights with Readwise (or manually). They land in your vault as raw quotes
2. **Distill** — Select a highlight, right-click → "Distill highlight to note." Write the idea in your own words. Cairn creates an atomic note with the reference attached
3. **Create a project** — Give it an argumentative title (*"Growth is killing Moab's character"*)
4. **Pull in notes** — Fuzzy search your vault, add notes as sections. Content is copied in, so you can freely edit it
5. **Browse & collect** — Navigate source notes with the sidebar open. Right-click quotes to add them directly to your essay
6. **Rearrange** — Drag sections or use arrow buttons to build your argument
7. **Write** — Hit "Open Essay" to return. Edit directly in the file; the sidebar reflects your structure live
8. **Extract back** — When a new idea emerges, extract it as a standalone note. The Zettelkasten loop completes
9. **Export** — Copy to clipboard with wikilinks stripped, headings optionally removed, ready for publication

## Features

### Sidebar Panel
- **Section cards** for each `## Heading` in your essay
- **Click to jump** to any section in the editor
- **Drag-and-drop** or **arrow buttons** to reorder
- **Word count** updates live as you write
- **Open Essay** button to navigate back to the project file from anywhere

### Pull In Notes
- Fuzzy search with source folder picker in the dialog
- Strips frontmatter and redundant headings
- Auto-tracks sources in a pinned section (configurable name)
- **Related Notes** panel surfaces `[[wikilinks]]` from your content as suggestions

### Browsing Workflow
Keep the sidebar open while navigating source notes. Right-click selected text for:
- **Add quote to essay** — Inserts a blockquote section with a `Quote: ...` heading and `— [[Source]]` attribution
- **Distill highlight to note** — Opens a modal to turn a highlight into an atomic note (see below)

Then hit **Open Essay** to return and write your connective tissue.

### Collect vs. Distill

These two actions are intentionally separate — they map to different stages of thinking:

- **Collect** (Add Quote) — Grab raw material. You're reading, something resonates, you toss it into the essay as-is. Fast, low friction, no thinking required yet. The quote sits there with its attribution, waiting.
- **Distill** (Distill Highlight) — Do the thinking. You stop and ask "what does this actually mean to me?" The output is *your* idea, in *your* words, with the source attached as a reference. That's a permanent addition to your vault, not just your essay.

If you're familiar with Tiago Forte's CODE framework (Capture, Organize, Distill, Express), Cairn maps directly to it:

| CODE | Cairn |
|------|-------|
| **Capture** | Readwise highlights, reading, bookmarks |
| **Organize** | Pull in notes, rearrange in sidebar |
| **Distill** | Distill Highlight — turn quotes into your own ideas |
| **Express** | Write the essay, Export Final Essay |

"Add Quote" lives between Capture and Organize — you're collecting raw material into your essay's structure. "Distill" is explicitly the D — the moment someone else's words become your knowledge. You can mix both freely in one session.

### Distill Highlight
Turn highlights into atomic notes in your own words:
1. Select a quote in any file (works especially well with Readwise imports)
2. Right-click → "Distill highlight to note" (or use the command palette)
3. Modal shows the quote, source info, and a text area for your idea
4. Title auto-suggests from your idea text
5. Creates an atomic note with a `## Reference` section (quote, source link, author, View Highlight URL)
6. Optional: automatically adds the new note to your active essay

Parses Readwise `## Metadata` and `## Highlights` sections for author, URL, and highlight links.

### Extract Back
- Turn any section into a standalone vault note with one click
- Choose the destination folder
- Source tracking updated automatically
- Essay text stays intact — you're birthing a new note, not hollowing out your writing

### Export Final Essay
- Strips `[[wikilinks]]` (keeps display text)
- Removes the Sources section
- Option to include or strip `##` headings (configurable in settings)
- Copies to clipboard with word count confirmation

### Structural Heading Styling
When editing the project file, `##` headings appear with a subtle left accent border and muted color — a visual cue that they're structural dividers, not essay content. This styling only applies to the active project file.

### Settings
- Configurable pinned section name (Sources, Bibliography, References, etc.)
- Adjustable Related Notes suggestion count
- Export: include or strip headings
- Distill: default folder for new notes
- Distill: add backlink to source file toggle

## Architecture

**The file is the source of truth.** No hidden markers, no sync engine, no compile step.

- Your essay is a plain markdown file that works without the plugin
- The sidebar reads `## ` headings and shows them as cards
- Every action (add, remove, reorder, extract) is a surgical text edit
- Reads from the editor buffer to avoid overwriting unsaved changes
- Live updates via debounced file watcher

This means zero lock-in. Disable the plugin and your essay is still a perfectly normal markdown document.

## Installation

### Manual
1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder: `{your-vault}/.obsidian/plugins/note-assembler/`
3. Copy the three files into it
4. In Obsidian: Settings > Community Plugins > Enable "Cairn — Essay Composer"

### From Community Plugins *(coming soon)*
Search "Cairn" or "essay composer" in Settings > Community Plugins > Browse.

## Usage Tips

- **Start with a thesis.** The "New Essay" prompt nudges you toward an argumentative title. A clear claim makes it easier to decide which notes belong and which don't.
- **Set a source folder** in the "Add Note" dialog to filter the fuzzy search to a specific area of your vault.
- **Use the browsing workflow.** Keep the sidebar open while reading source notes. Add quotes and distill highlights as you go, then hit "Open Essay" to write.
- **Use Related Notes** to follow the trail. When you pull in a note that links to other notes, they'll appear as suggestions.
- **Distill, don't just collect.** The Distill modal asks "What does this mean to you?" — writing the idea in your own words is where the thinking happens.
- **Extract freely.** If you write three paragraphs that feel like their own idea, extract them. The best notes are born during writing, not before it.

## Built By

[Maggie McGuire](https://moabsunnews.com) — journalist and publisher of Moab Sun News in Moab, Utah. Built this to write better essays from better notes.

If Cairn helps your writing, [buy me a coffee](https://buymeacoffee.com/maggiemcguire).

## License

MIT
