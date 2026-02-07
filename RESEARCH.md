# Cairn — Research: Notes-to-Output Workflows

How practitioners go from atomic notes to finished essays/books. Collected to inform Cairn's Express-stage design (v0.4+).

## The Universal Pattern

Across all five examples, composition follows the same structure:

1. **Gather** — pull notes into a working area (physical table, sandbox doc, outline note)
2. **Arrange** — group and sequence until structure emerges (themes, sections, argument flow)
3. **Identify gaps** — see what's missing, write new material to fill holes
4. **Draft as translation** — convert note-language into prose, write connective tissue
5. **Revise** — edit the assembled draft into coherent narrative

The universal claim: this feels like "editing, not composition" because the hard thinking happened during note-making.

---

## 1. Ryan Holiday — Notecard System

**Source:** [The Notecard System](https://ryanholiday.net/the-notecard-system-the-key-for-remembering-organizing-and-using-everything-you-read/) | [How Ryan Holiday Writes a Book](https://thewaiterspad.com/2016/09/21/how-ryan-holiday-writes-a-book/)

**Workflow:**
1. Read and mark — underline passages, flag with Post-its
2. Delayed transcription — weeks later, transfer to 4x6 index cards with theme in top-right corner
3. File by project — cards into storage boxes organized by book section/theme
4. Physical arrangement — pull all cards for a chapter, spread on table, physically rearrange until argument structure emerges
5. Draft in Google Docs — write from arranged cards, one doc per chapter
6. Combine into Word — merge chapter docs, switch to offline editing
7. Recursive revision — write first third, edit it; write second third, edit I+II together; etc.

**Key insight:** "He is not writing to figure out what he has to say." The notecard system means all thinking and discovery happens during reading and card-filing. Composition is assembly, not exploration. The physical manipulation of cards — literally moving them on a surface — IS the outlining step. There is no separate outline phase.

**Tools:** 4x6 index cards (color-coded), Cropper Hopper storage boxes, Google Docs, Word

**Relevance to Cairn:** The sidebar drag model emulates Holiday's physical card-arranging. His workflow validates the "arrange then write" pattern.

---

## 2. Sönke Ahrens / Niklas Luhmann — Zettelkasten Bottom-Up Writing

**Source:** [How to Take Smart Notes — Deep Summary](https://www.sloww.co/how-to-take-smart-notes/) | [From Fleeting Notes to Project Notes](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/)

**Workflow (Ahrens' 8-step composition):**
1. Decide on a topic from within the slip-box — based on what you have, not an unfounded idea
2. Collect relevant notes — most will already be in partial order from linking
3. Transfer to a working surface
4. Order and assess — arrange in sequence
5. Identify gaps early — don't wait until everything is together
6. Create rough draft — "translate them into something coherent and embed them into the context of your argument"
7. Detect and fill holes
8. Edit and proofread

**Key insight:** Topic selection itself comes from the notes, not from the writer's head. You never face a blank page because you write "bottom-up" — the slip-box tells you what you're ready to write about based on where clusters of connected notes have accumulated. Luhmann said he "never forced himself to do anything he didn't feel like." The composition stage is translation: converting note-language into prose-language while building argument structure.

**Tools:** Luhmann: physical paper slips with alphanumeric IDs. Modern: Obsidian, Zettlr, any linked-note tool.

**Relevance to Cairn:** The "decide on a topic from your notes" pattern suggests Cairn could help users discover what they're ready to write about — surfacing note clusters, not just managing known projects.

---

## 3. Tiago Forte — CODE Method with Intermediate Packets

**Source:** [Building a Second Brain Overview](https://fortelabs.com/blog/basboverview/) | [Intermediate Packets in the Wild](https://fortelabs.com/blog/intermediate-packets-in-the-wild/)

**Workflow (Express stage of CODE):**
1. Capture — save anything that resonates
2. Organize by project — notes live closest to the active project they serve (PARA)
3. Distill via Progressive Summarization — bold key passages → highlight boldest → executive summary
4. Express by assembling Intermediate Packets — search Second Brain for relevant distilled notes, arrange into rough structure
5. Draft from assembled packets — write connective tissue between them
6. Ship as v1.0 — publish imperfect work early, iterate on feedback

**Key insight:** "Intermediate Packets" — end every work session with one concrete, reusable deliverable (a set of notes, an outline, a list of examples). Over time these accumulate, and composition becomes searching, pulling packets, arranging, and writing glue. Forte frames the Second Brain "not as a warehouse but as a factory." The goal: make it feel "more like editing than composition."

**Tools:** Notion (previously Evernote). Method is tool-agnostic.

**Relevance to Cairn:** Cairn's Distill Highlight creates intermediate packets. The gap: Cairn pulls in full notes, but Forte's method assumes notes are already distilled to their essence. Progressive summarization layers (bold → highlight → summary) aren't represented in Cairn's pull-in model.

---

## 4. Andy Matuschak — Evergreen Notes + Speculative Outlines

**Source:** [Executable Strategy for Writing](https://notes.andymatuschak.org/Executable_strategy_for_writing) | [Create Speculative Outlines While You Write](https://notes.andymatuschak.org/Create_speculative_outlines_while_you_write)

**Workflow (two variants):**

*Organic / undirected:*
1. Write evergreen notes continuously — atomic, concept-oriented, titled as claims
2. Link each new note to a speculative outline — "What essay might this contribute to?"
3. Wait for ripeness — an outline accumulates enough notes to feel ready
4. Fill gaps — write missing notes
5. Concatenate — copy linked notes in outline order into a single document
6. Rewrite — edit into cohesive prose

*Directed / project-specific:*
1. Review related notes
2. Create an outline
3. Attach existing notes to outline points; write new notes for gaps
4. Concatenate into manuscript
5. Rewrite

**Key insight:** Each step feels "doable" — not "write chapter 1" (intimidating) but "find notes which seem relevant" (concrete, searchable). Speculative outlines mean you're always pre-building essay structures as a side effect of daily note-writing. Material cut from one essay "can become a durable note, seeding a network of links" for future essays — nothing is wasted.

**Tools:** Custom system (visible at notes.andymatuschak.org). Works with any linked-note tool.

**Relevance to Cairn:** Matuschak's speculative outlines map directly to the v0.4 nested sections concept — `##` headings as essay structure that notes attach to over time. His "directed" variant is almost exactly Cairn's target workflow.

---

## 5. Bob Doto — The "Notes File" Bridge

**Source:** [How I Start a Book Project Using a Zettelkasten](https://writing.bobdoto.computer/how-i-start-a-book-project-using-a-zettelkasten/) | Book: *A System for Writing* (2024)

**Workflow:**
1. Create a "Notes file" — a single sandbox document, a dumping ground for everything: thoughts, title ideas, rough TOC, quotes, questions, notes-to-self
2. Search the Zettelkasten — pull anything relevant, copy-paste into the Notes file. Follow connections to find adjacent ideas
3. Create reference notes for new research — capture project-relevant findings from new reading
4. Group under thematic headings — organize accumulated material under temporary section headers. "This is where formlessness becomes form"
5. Break into chapter files — when Notes file gets unwieldy, split into numbered chapter files
6. Draft within chapter files — write prose drawing from grouped notes already placed there
7. Feed new insights back — discoveries during writing become standalone notes added back to the Zettelkasten

**Key insight:** The "Notes file" is the missing bridge most Zettelkasten practitioners skip. It's explicitly messy and low-pressure — a staging area before imposing structure. The grouping-under-headings step (4) is where the actual intellectual work happens: deciding what goes with what, what the argument looks like. Doto also addresses byproducts — insights from writing get fed back into the permanent system.

**Tools:** Plain text/markdown in folders. Demonstrated in Obsidian but tool-agnostic.

**Relevance to Cairn:** Doto's "Notes file" is the closest analog to what Cairn does today. His workflow validates the project-file-as-sandbox approach. The grouping-under-headings step is exactly what nested sections (v0.4) would formalize. His "feed back" step (7) maps to Cairn's extract-back feature.

---

## Design Implications for Cairn

| Practitioner | What Cairn already does | What Cairn could learn |
|---|---|---|
| Holiday | Sidebar drag = card arranging | Physical spread → need for spatial overview, not just linear list |
| Ahrens/Luhmann | — | Topic discovery from note clusters, not just managing known projects |
| Forte | Distill Highlight creates packets | Pull in distilled layers, not full notes. Progressive summarization awareness |
| Matuschak | — | Speculative outlines = nested sections that accumulate notes over time |
| Doto | Project file = Notes file sandbox | Grouping-under-headings = nested sections. Feed-back = extract-back |

**Strongest signal:** Three of five practitioners (Matuschak, Doto, Ahrens) describe a workflow where structure emerges from grouping notes under headings — exactly the nested sections model planned for v0.4.
