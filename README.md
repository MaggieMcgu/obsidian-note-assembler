# Note Assembler

**Pull atomic notes into essays. Reorder your argument. Extract new ideas back out.**

Note Assembler bridges the gap between *thinking in notes* and *writing in prose*. If you use a Zettelkasten, evergreen notes, or any atomic note system, you've probably felt the friction of turning a web of linked ideas into a linear essay. This plugin makes that process feel natural.

## The Problem

You have 200 notes. You need to write an essay. The current options:

- **Copy-paste** — Tedious, loses connection to source notes
- **Embeds (`![[Note]]`)** — Read-only, can't edit the text
- **Longform plugin** — Built for novels with scenes/chapters, not for assembling ideas

Note Assembler takes a different approach: your essay is a normal markdown file. The plugin gives you a sidebar to pull notes in, rearrange them, and write — then extract new ideas back into your vault when they emerge.

## How It Works

1. **Create a project** — Give it an argumentative title (*"Growth is killing Moab's character"*)
2. **Pull in notes** — Fuzzy search your vault, add notes as sections. Content is copied in, so you can freely edit it for your new context
3. **Rearrange** — Drag sections or use arrow buttons to build your argument
4. **Write** — Edit directly in the markdown file. The sidebar reflects your structure in real-time
5. **Extract back** — When a new idea emerges while writing, click the arrow to extract it as a standalone note. The Zettelkasten loop completes
6. **Export clean** — Copy to clipboard with wikilinks stripped, ready to paste into a blog, email, or doc

## Features

### Sidebar Panel
- **Section cards** for each `## Heading` in your essay
- **Click to jump** to any section in the editor
- **Drag-and-drop** or **arrow buttons** to reorder
- **Word count** updates live as you write

### Pull In Notes
- Fuzzy search filtered by source folder
- Strips frontmatter and redundant headings
- Auto-tracks sources in a `## Sources` section
- **Related Notes** panel surfaces `[[wikilinks]]` from your content as suggestions

### Extract Back
- Turn any section into a standalone vault note with one click
- Choose the destination folder
- Source tracking updated automatically
- Essay text stays intact — you're birthing a new note, not hollowing out your writing

### Clean Export
- Strips `[[wikilinks]]` (keeps display text)
- Removes the Sources section
- Copies to clipboard with word count confirmation
- Also available as a command palette action

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
4. In Obsidian: Settings > Community Plugins > Enable "Note Assembler"

### From Community Plugins *(coming soon)*
Search "Note Assembler" in Settings > Community Plugins > Browse.

## Usage Tips

- **Start with a thesis.** The "New Essay" prompt nudges you toward an argumentative title. A clear claim makes it easier to decide which notes belong and which don't.
- **Set a source folder** to filter the fuzzy search to a specific area of your vault.
- **Use Related Notes** to follow the trail. When you pull in a note that links to other notes, they'll appear as suggestions — this is how Zettelkasten exploration works.
- **Extract freely.** If you write three paragraphs that feel like their own idea, extract them. The best notes are born during writing, not before it.

## Built By

[Maggie McGuire](https://moabsunnews.com) — journalist and publisher of Moab Sun News in Moab, Utah. Built this to write better essays from better notes.

If Note Assembler helps your writing, [buy me a coffee](https://buymeacoffee.com/maggiemcguire).

## License

MIT
