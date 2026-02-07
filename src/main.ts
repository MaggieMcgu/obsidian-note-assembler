import {
  App,
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  debounce,
  setIcon,
} from "obsidian";

// ── Data Model (minimal — file is the source of truth) ──────

interface Project {
  id: string;
  name: string;
  filePath: string;
  sourceFolder: string; // vault-relative folder path, "" = all
}

interface NoteAssemblerSettings {
  pinnedSectionName: string;
  maxRelatedNotes: number;
  distillDefaultFolder: string;
  addBacklinkToSource: boolean;
  exportIncludeHeadings: boolean;
}

const DEFAULT_SETTINGS: NoteAssemblerSettings = {
  pinnedSectionName: "Sources",
  maxRelatedNotes: 6,
  distillDefaultFolder: "",
  addBacklinkToSource: false,
  exportIncludeHeadings: true,
};

interface NoteAssemblerData {
  projects: Project[];
  activeProjectId: string | null;
  settings: NoteAssemblerSettings;
}

const DEFAULT_DATA: NoteAssemblerData = {
  projects: [],
  activeProjectId: null,
  settings: DEFAULT_SETTINGS,
};

const VIEW_TYPE = "note-assembler-view";

// ── Section: a parsed h2 block from the file ────────────────

interface Section {
  heading: string;
  startLine: number;
  endLine: number; // exclusive — first line of next section (or EOF)
  pinned: boolean; // true for Sources — can't be dragged
}

// ── Plugin ──────────────────────────────────────────────────

export default class NoteAssemblerPlugin extends Plugin {
  data: NoteAssemblerData = DEFAULT_DATA;

  async onload() {
    await this.loadPluginData();

    this.registerView(VIEW_TYPE, (leaf) => new AssemblerView(leaf, this));

    this.addRibbonIcon("layers", "Cairn — Essay Composer", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-note-assembler",
      name: "Open Cairn",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "add-current-note",
      name: "Add current note to active project",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const project = this.getActiveProject();
        const projectFile = project
          ? this.app.vault.getAbstractFileByPath(project.filePath)
          : null;
        if (!file || !project || !projectFile || !(projectFile instanceof TFile))
          return false;
        // Don't add the project file to itself
        if (file.path === project.filePath) return false;
        if (checking) return true;
        this.addNoteToProject(project, file);
        return true;
      },
    });

    this.addCommand({
      id: "add-blank-section",
      name: "Add blank section to active project",
      checkCallback: (checking) => {
        const project = this.getActiveProject();
        if (!project) return false;
        if (checking) return true;
        this.addBlankSection(project);
        return true;
      },
    });

    this.addCommand({
      id: "copy-clean-export",
      name: "Export final essay to clipboard",
      checkCallback: (checking) => {
        const project = this.getActiveProject();
        if (!project) return false;
        if (checking) return true;
        this.copyCleanExport(project);
        return true;
      },
    });

    this.addCommand({
      id: "extract-selection-to-note",
      name: "Extract selection to new note",
      editorCheckCallback: (checking, editor) => {
        const project = this.getActiveProject();
        const selection = editor.getSelection();
        if (!project || !selection.trim()) return false;
        if (checking) return true;
        this.extractSelectionToNote(project, selection);
        return true;
      },
    });

    this.addCommand({
      id: "add-selection-to-essay",
      name: "Add quote to essay",
      editorCheckCallback: (checking, editor, view) => {
        const project = this.getActiveProject();
        const selection = editor.getSelection();
        if (!project || !selection.trim() || !view.file) return false;
        if (checking) return true;
        this.addSelectionToEssay(project, selection, view.file);
        return true;
      },
    });

    this.addCommand({
      id: "distill-highlight",
      name: "Distill highlight to note",
      editorCheckCallback: (checking, editor, view) => {
        const selection = editor.getSelection();
        if (!selection.trim()) return false;
        if (checking) return true;
        const file = view.file;
        if (!file) return false;
        this.distillHighlight(selection, file);
        return true;
      },
    });

    this.addSettingTab(new NoteAssemblerSettingTab(this.app, this));

    // Right-click context menu
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        if (selection.trim() && view.file) {
          const project = this.getActiveProject();
          if (project) {
            menu.addItem((item) => {
              item
                .setTitle("Add quote to essay")
                .setIcon("plus-circle")
                .onClick(() => {
                  this.addSelectionToEssay(project, selection, view.file!);
                });
            });
          }
          menu.addItem((item) => {
            item
              .setTitle("Distill highlight to note")
              .setIcon("sparkles")
              .onClick(() => {
                this.distillHighlight(selection, view.file!);
              });
          });
        }
      })
    );

    // Watch for file changes to update sidebar
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const project = this.getActiveProject();
        if (project && file instanceof TFile && file.path === project.filePath) {
          this.refreshView();
          // Re-apply heading class after DOM settles from file change
          setTimeout(() => this.updateProjectFileClass(), 50);
        }
      })
    );

    // Tag editor with CSS class when viewing the active project file
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateProjectFileClass();
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.updateProjectFileClass();
      })
    );

    // Restore sidebar + heading class once workspace is ready
    this.app.workspace.onLayoutReady(() => {
      // Re-open sidebar if it was closed (e.g. plugin toggled off/on)
      if (this.data.projects.length > 0) {
        this.activateView();
      }
      // Apply heading class after a tick so the view is mounted
      setTimeout(() => this.updateProjectFileClass(), 100);
    });
  }

  onunload() {
    // Remove project-file class from all editors on plugin unload
    document.querySelectorAll(".cairn-project-file").forEach((el) => {
      el.classList.remove("cairn-project-file");
    });
  }

  /** Add/remove .cairn-project-file on the active editor container */
  updateProjectFileClass() {
    // Remove from all editors first
    document.querySelectorAll(".cairn-project-file").forEach((el) => {
      el.classList.remove("cairn-project-file");
    });
    const project = this.getActiveProject();
    if (!project) return;
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.path !== project.filePath) return;
    const activeLeafEl = document.querySelector(
      ".workspace-leaf.mod-active .markdown-source-view"
    );
    if (activeLeafEl) {
      activeLeafEl.classList.add("cairn-project-file");
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      leaf = rightLeaf;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  getActiveProject(): Project | null {
    if (!this.data.activeProjectId) return null;
    return (
      this.data.projects.find((p) => p.id === this.data.activeProjectId) ??
      null
    );
  }

  // ── Parse h2 sections from file content ──

  parseSections(content: string): Section[] {
    const lines = content.split("\n");
    const sections: Section[] = [];
    let current: Section | null = null;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^## (.+)$/);
      if (match) {
        if (current) {
          current.endLine = i;
          sections.push(current);
        }
        current = {
          heading: match[1],
          startLine: i,
          endLine: lines.length,
          pinned: match[1].trim() === this.data.settings.pinnedSectionName,
        };
      }
    }
    if (current) {
      current.endLine = lines.length;
      sections.push(current);
    }

    return sections;
  }

  // ── Get file content from editor buffer if open, else disk ──

  async getFileContent(file: TFile): Promise<string> {
    // Try to get from open editor first
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.file?.path === file.path && view?.editor) {
        return view.editor.getValue();
      }
    }
    return await this.app.vault.read(file);
  }

  // ── Modify file through editor if open, else vault.modify ──

  async setFileContent(file: TFile, content: string) {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.file?.path === file.path && view?.editor) {
        view.editor.setValue(content);
        return;
      }
    }
    await this.app.vault.modify(file, content);
  }

  // ── Add a vault note as a new section ──

  async addNoteToProject(project: Project, sourceFile: TFile) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    let sourceContent = await this.app.vault.read(sourceFile);
    // Strip YAML frontmatter
    sourceContent = sourceContent.replace(/^---\n[\s\S]*?\n---\n?/, "");
    // Strip top-level heading if it matches filename
    const headingPattern = new RegExp(
      `^#\\s+${escapeRegex(sourceFile.basename)}\\s*\n?`
    );
    sourceContent = sourceContent.replace(headingPattern, "").trim();

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);

    // Build new section
    const newSection = `## ${sourceFile.basename}\n\n${sourceContent}`;

    // Insert before Sources if it exists, else append
    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      // Add wikilink to Sources section
      const beforeSources = lines.slice(0, sourcesSection.startLine).join("\n");
      const sourcesLines = lines.slice(sourcesSection.startLine);
      const sourcesText = sourcesLines.join("\n");
      // Append link to Sources
      const updatedSources = sourcesText.trimEnd() + `\n- [[${sourceFile.basename}]]`;
      newContent = beforeSources.trimEnd() + "\n\n" + newSection + "\n\n" + updatedSources + "\n";
    } else {
      // No pinned section yet — add section + create it
      const pinnedName = this.data.settings.pinnedSectionName;
      newContent =
        content.trimEnd() +
        "\n\n" +
        newSection +
        `\n\n---\n\n## ${pinnedName}\n\n` +
        `- [[${sourceFile.basename}]]` +
        "\n";
    }

    await this.setFileContent(projectFile, newContent);
    new Notice(`Added "${sourceFile.basename}" to ${project.name}`);
  }

  // ── Add a blank section ──

  async addBlankSection(project: Project) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);
    const newSection = "## New Section\n\n";

    // Insert before Sources if it exists
    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines.slice(0, sourcesSection.startLine).join("\n");
      const sourcesText = lines.slice(sourcesSection.startLine).join("\n");
      newContent = beforeSources.trimEnd() + "\n\n" + newSection + "\n" + sourcesText;
    } else {
      newContent = content.trimEnd() + "\n\n" + newSection;
    }

    await this.setFileContent(projectFile, newContent);

    // Scroll editor to the new section
    const newSections = this.parseSections(newContent);
    const newSec = newSections.filter((s) => !s.pinned).pop();
    if (newSec) {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const view = leaf.view as any;
        if (view?.file?.path === projectFile.path && view?.editor) {
          view.editor.setCursor({ line: newSec.startLine, ch: 0 });
          view.editor.scrollIntoView(
            {
              from: { line: newSec.startLine, ch: 0 },
              to: { line: newSec.startLine + 2, ch: 0 },
            },
            true
          );
          this.app.workspace.revealLeaf(leaf);
          break;
        }
      }
    }
  }

  // ── Reorder: move a section to a new position ──

  async moveSection(project: Project, fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;

    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const allSections = this.parseSections(content);

    // Only operate on non-pinned sections
    const draggable = allSections.filter((s) => !s.pinned);
    if (fromIndex >= draggable.length || toIndex >= draggable.length) return;

    const lines = content.split("\n");
    const section = draggable[fromIndex];
    const sectionLines = lines.slice(section.startLine, section.endLine);

    // Remove the section's lines
    lines.splice(section.startLine, section.endLine - section.startLine);

    // Reparse after removal to get correct line numbers
    const afterRemoval = lines.join("\n");
    const remainingSections = this.parseSections(afterRemoval).filter((s) => !s.pinned);

    // Determine insertion line
    let insertLine: number;
    if (toIndex >= remainingSections.length) {
      // Insert at end (before Sources if present)
      const pinned = this.parseSections(afterRemoval).find((s) => s.pinned);
      insertLine = pinned ? pinned.startLine : lines.length;
    } else {
      insertLine = remainingSections[toIndex].startLine;
    }

    // Clean up: ensure blank line before inserted section
    // Trim trailing blank lines from the section we're inserting
    while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1].trim() === "") {
      sectionLines.pop();
    }

    // Insert with proper spacing
    const before = lines.slice(0, insertLine);
    const after = lines.slice(insertLine);

    // Trim trailing blanks from 'before' to avoid excess whitespace
    while (before.length > 0 && before[before.length - 1].trim() === "") {
      before.pop();
    }

    const parts: string[] = [];
    if (before.length > 0) {
      parts.push(before.join("\n"));
    }
    parts.push(sectionLines.join("\n"));
    if (after.length > 0) {
      // Trim leading blanks from 'after'
      while (after.length > 0 && after[0].trim() === "") {
        after.shift();
      }
      parts.push(after.join("\n"));
    }

    const newContent = parts.join("\n\n") + "\n";
    await this.setFileContent(projectFile, newContent);
  }

  // ── Remove a section ──

  async removeSection(project: Project, sectionIndex: number) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const allSections = this.parseSections(content);
    const draggable = allSections.filter((s) => !s.pinned);
    if (sectionIndex >= draggable.length) return;

    const section = draggable[sectionIndex];
    const lines = content.split("\n");

    // Remove section lines
    lines.splice(section.startLine, section.endLine - section.startLine);

    // Clean up double blank lines
    const newContent = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    await this.setFileContent(projectFile, newContent);
  }

  // ── Extract a section back to a standalone note ──

  async extractSection(project: Project, sectionIndex: number) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const allSections = this.parseSections(content);
    const draggable = allSections.filter((s) => !s.pinned);
    if (sectionIndex >= draggable.length) return;

    const section = draggable[sectionIndex];
    const lines = content.split("\n");

    // Extract body lines (everything after the heading)
    const bodyLines = lines.slice(section.startLine + 1, section.endLine);
    // Trim leading/trailing blank lines
    while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "") bodyLines.pop();

    if (bodyLines.length === 0) {
      new Notice("Cannot extract an empty section");
      return;
    }

    const safeName = sanitizeFilename(section.heading);

    // Show modal to pick destination folder
    new ExtractModal(this.app, safeName, project.sourceFolder || "", async (folder) => {
      const targetPath = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        new Notice(`File "${targetPath}" already exists`);
        return;
      }

      await this.app.vault.create(targetPath, bodyLines.join("\n") + "\n");

      // Add to Sources (create section if missing)
      const sourcesSection = allSections.find((s) => s.pinned);
      if (sourcesSection) {
        const sourcesBody = lines
          .slice(sourcesSection.startLine, sourcesSection.endLine)
          .join("\n");
        if (!sourcesBody.includes(`[[${safeName}]]`)) {
          lines.splice(sourcesSection.endLine, 0, `- [[${safeName}]]`);
          await this.setFileContent(projectFile, lines.join("\n"));
        }
      } else {
        const pinnedName = this.data.settings.pinnedSectionName;
        const newContent = content.trimEnd() + `\n\n---\n\n## ${pinnedName}\n\n` + `- [[${safeName}]]` + "\n";
        await this.setFileContent(projectFile, newContent);
      }

      new Notice(`Extracted "${section.heading}" to ${targetPath}`);
    }).open();
  }

  // ── Copy clean export to clipboard ──

  async copyCleanExport(project: Project) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const allSections = this.parseSections(content);
    const draggable = allSections.filter((s) => !s.pinned);

    if (draggable.length === 0) {
      new Notice("Nothing to export");
      return;
    }

    const lines = content.split("\n");
    const includeHeadings = this.data.settings.exportIncludeHeadings;
    const parts: string[] = [];
    for (const section of draggable) {
      let sectionLines = lines.slice(section.startLine, section.endLine);
      if (!includeHeadings) {
        // Strip the ## heading line
        sectionLines = sectionLines.filter((l) => !l.match(/^## .+$/));
      }
      parts.push(sectionLines.join("\n"));
    }

    let output = parts.join("\n\n");
    // Strip wikilinks: [[Target|Display]] → Display, [[Target]] → Target
    output = output.replace(/\[\[([^\]|]+)\|([^\]]+)]]/g, "$2");
    output = output.replace(/\[\[([^\]]+)]]/g, "$1");
    // Clean up excess blank lines
    output = output.replace(/\n{3,}/g, "\n\n").trim();

    await navigator.clipboard.writeText(output);
    const wordCount = output.split(/\s+/).filter((w) => w.length > 0).length;
    new Notice(`Copied to clipboard (${wordCount} words)`);

    // Offer to untrack after export
    setTimeout(() => {
      if (confirm(`Essay exported. Untrack "${project.name}"? The file stays in your vault.`)) {
        this.untrackProject(project.id);
      }
    }, 300);
  }

  async untrackProject(projectId: string) {
    this.data.projects = this.data.projects.filter((p) => p.id !== projectId);
    this.data.activeProjectId = this.data.projects[0]?.id ?? null;
    await this.savePluginData();
    this.refreshView();
  }

  // ── Sample project ──

  async createSampleProject(): Promise<void> {
    const filePath = "Cairn — Getting Started.md";
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing) {
      new Notice("Sample project already exists");
      return;
    }

    const content = `# Cairn — Getting Started

## What you're looking at

This is a sample project — a real Cairn essay built with the plugin's own features. The sidebar on the right shows the structure of this file. Each card represents one of the \`## \` headings below.

**Try it now:** Click any card in the sidebar to jump to that section.

Notice how the headings have a subtle left border? That's Cairn telling you these are *structural dividers*, not essay content. Everything between them is where you write.

<!-- GIF placeholder: sidebar-overview.gif — Show the sidebar with cards, clicking to jump -->

## Pulling in notes

When you click **Add Note** in the sidebar, Cairn searches your vault and copies the note's content into your essay as a new section. The original note stays untouched — you can freely edit the pulled-in text for your new context.

The **Main Source** folder picker at the top of the search dialog lets you narrow results to a specific area of your vault.

<!-- GIF placeholder: add-note.gif — Click Add Note, pick folder, select a note, show it appear -->

## Rearranging your argument

Drag the cards in the sidebar, or use the arrow buttons, to reorder sections. The file updates instantly — what you see in the editor is always the real document.

<!-- GIF placeholder: reorder.gif — Drag a card to a new position, show file text move -->

## Quote: "The best way to have a good idea is to have a lot of ideas"

> The best way to have a good idea is to have a lot of ideas.

— Linus Pauling

*This is what a quote looks like.* Select text in any note, right-click, and choose **"Add quote to essay."** Cairn creates a blockquote section with a \`Quote:\` heading and inline attribution.

<!-- GIF placeholder: add-quote.gif — Select text, right-click, Add quote to essay -->

## The browsing workflow

This is where Cairn really clicks. Keep the sidebar open while you navigate through source notes, reading and collecting as you go:

1. **Browse** — Open source notes, read through highlights and ideas
2. **Collect** — Right-click quotes to add them, or distill highlights into new notes
3. **Return** — Hit **Open Essay** to jump back to your project file
4. **Write** — Add the connective tissue between your collected pieces

The sidebar stays with you the whole time, showing your growing outline.

<!-- GIF placeholder: browsing-workflow.gif — Navigate to source note, add quote, hit Open Essay, write between sections -->

## Distilling highlights

The Distill feature turns raw highlights into atomic notes in your own words:

1. Select a highlight in any file (works great with Readwise imports)
2. Right-click → **"Distill highlight to note"**
3. Write your idea — *what does this quote mean to you?*
4. Cairn creates a note with a \`## Reference\` section linking back to the source

If you have an active project, check **"Add to essay"** to pull the new note in automatically.

<!-- GIF placeholder: distill.gif — Select highlight, right-click, Distill modal, write idea, create -->

## Extracting new ideas

Sometimes you write something that deserves to be its own note. Click the **↗** arrow on any section card to extract it back into your vault as a standalone note. The essay text stays intact.

This completes the loop: notes become essays, and essays birth new notes.

<!-- GIF placeholder: extract.gif — Click extract arrow, choose folder, show new note created -->

## Exporting your finished essay

When you're done, click **Export Final Essay** in the sidebar. Cairn copies your essay to the clipboard with:

- \`[[Wikilinks]]\` stripped (display text kept)
- Sources section removed
- Optionally: headings stripped (toggle in Settings → Cairn)

Ready to paste into a blog, email, or doc.

## What to do next

You've seen how Cairn works. Here's how to start:

1. **Create your own essay** — Click **+** in the sidebar and give it an argumentative title
2. **Delete this sample** — Click the trash icon on the project selector
3. **Explore settings** — Settings → Cairn for export options, distill defaults, and more

*Tip: Start with a claim, not a topic. "Growth is killing Moab's character" gives you something to argue. "Growth in Moab" gives you nothing to cut against.*

## Sources

- [[Cairn Documentation]]
`;

    await this.app.vault.create(filePath, content);

    const project: Project = {
      id: generateId(),
      name: "Cairn — Getting Started",
      filePath,
      sourceFolder: "",
    };
    this.data.projects.push(project);
    this.data.activeProjectId = project.id;
    await this.savePluginData();
    this.refreshView();

    // Open the sample file in the editor
    const newFile = this.app.vault.getAbstractFileByPath(filePath);
    if (newFile instanceof TFile) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(newFile);
    }
  }

  // ── Extract selection to a new note ──

  async extractSelectionToNote(project: Project, selection: string) {
    const defaultFolder = project.sourceFolder || "";

    new ExtractSelectionModal(this.app, defaultFolder, async (noteName, folder) => {
      const safeName = sanitizeFilename(noteName);
      if (!safeName) {
        new Notice("Note name cannot be empty");
        return;
      }

      const targetPath = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        new Notice(`File "${targetPath}" already exists`);
        return;
      }

      await this.app.vault.create(targetPath, selection.trim() + "\n");

      // Add to Sources in project file
      const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
      if (projectFile instanceof TFile) {
        const content = await this.getFileContent(projectFile);
        const lines = content.split("\n");
        const allSections = this.parseSections(content);
        const sourcesSection = allSections.find((s) => s.pinned);

        if (sourcesSection) {
          const sourcesBody = lines
            .slice(sourcesSection.startLine, sourcesSection.endLine)
            .join("\n");
          if (!sourcesBody.includes(`[[${safeName}]]`)) {
            lines.splice(sourcesSection.endLine, 0, `- [[${safeName}]]`);
            await this.setFileContent(projectFile, lines.join("\n"));
          }
        } else {
          const pinnedName = this.data.settings.pinnedSectionName;
          const newContent = content.trimEnd() + `\n\n---\n\n## ${pinnedName}\n\n` + `- [[${safeName}]]` + "\n";
          await this.setFileContent(projectFile, newContent);
        }
      }

      new Notice(`Created "${safeName}.md" from selection`);
    }).open();
  }

  // ── Add selected text directly as a section in the essay ──

  async addSelectionToEssay(project: Project, selection: string, sourceFile: TFile) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);

    // Heading from content: first ~60 chars, truncated at word boundary
    const trimmed = selection.trim();
    const headingText = trimmed.length > 60
      ? trimmed.substring(0, 60).replace(/\s+\S*$/, "") + "\u2026"
      : trimmed.split("\n")[0];
    const heading = "Quote: " + headingText.replace(/[#|[\]]/g, "");

    // Format as blockquote with inline attribution
    const blockquote = trimmed.split("\n").map((line) => `> ${line}`).join("\n");
    const sourceName = sourceFile.basename;
    const newSection = `## ${heading}\n\n${blockquote}\n\n\u2014 [[${sourceName}]]`;

    // Insert before Sources if it exists, else append
    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines.slice(0, sourcesSection.startLine).join("\n");
      const sourcesLines = lines.slice(sourcesSection.startLine);
      const sourcesText = sourcesLines.join("\n");
      // Add wikilink to Sources if not already there
      const updatedSources = sourcesText.includes(`[[${sourceName}]]`)
        ? sourcesText
        : sourcesText.trimEnd() + `\n- [[${sourceName}]]`;
      newContent = beforeSources.trimEnd() + "\n\n" + newSection + "\n\n" + updatedSources + "\n";
    } else {
      const pinnedName = this.data.settings.pinnedSectionName;
      newContent =
        content.trimEnd() +
        "\n\n" +
        newSection +
        `\n\n---\n\n## ${pinnedName}\n\n` +
        `- [[${sourceName}]]` +
        "\n";
    }

    await this.setFileContent(projectFile, newContent);
    new Notice(`Added quote to ${project.name}`);
  }

  // ── Distill a highlight into an atomic note ──

  async distillHighlight(selection: string, sourceFile: TFile) {
    const content = await this.app.vault.read(sourceFile);
    const metadata = parseSourceMetadata(content);
    const highlightMatch = findMatchingHighlight(selection, content);
    const defaultFolder = this.data.settings.distillDefaultFolder || "";
    const activeProject = this.getActiveProject();

    new DistillModal(
      this.app,
      selection,
      metadata,
      highlightMatch,
      sourceFile,
      defaultFolder,
      activeProject?.name ?? null,
      async (idea, title, folder, addToEssay) => {
        const safeName = sanitizeFilename(title);
        if (!safeName) {
          new Notice("Note title cannot be empty");
          return;
        }

        const targetPath = folder ? `${folder}/${safeName}.md` : `${safeName}.md`;

        if (this.app.vault.getAbstractFileByPath(targetPath)) {
          new Notice(`File "${targetPath}" already exists`);
          return;
        }

        // Build note content
        const quoteText = highlightMatch ? highlightMatch.cleanText : selection.trim();
        const lines: string[] = [];

        // Idea (may be empty — user can write later)
        if (idea.trim()) {
          lines.push(idea.trim());
        }

        lines.push("");
        lines.push("## Reference");
        lines.push("");
        lines.push(`> ${quoteText}`);
        lines.push("");
        lines.push(`- Source: [[${sourceFile.basename}]]`);
        if (metadata.author) {
          lines.push(`- Author: ${metadata.author}`);
        }
        if (highlightMatch?.linkMarkdown) {
          lines.push(`- ${highlightMatch.linkMarkdown}`);
        }
        lines.push("");

        await this.app.vault.create(targetPath, lines.join("\n"));

        // Optionally add backlink to source file
        if (this.data.settings.addBacklinkToSource) {
          const sourceContent = await this.app.vault.read(sourceFile);
          const notesHeading = "## Notes";
          const backlinkLine = `- [[${safeName}]]`;

          if (sourceContent.includes(notesHeading)) {
            // Append under existing ## Notes section
            const notesIdx = sourceContent.indexOf(notesHeading);
            const afterHeading = notesIdx + notesHeading.length;
            // Find the end of the Notes section (next ## or EOF)
            const nextSection = sourceContent.indexOf("\n## ", afterHeading);
            const insertPos = nextSection !== -1 ? nextSection : sourceContent.length;
            const updatedContent =
              sourceContent.slice(0, insertPos).trimEnd() +
              "\n" + backlinkLine + "\n" +
              (nextSection !== -1 ? "\n" + sourceContent.slice(nextSection + 1) : "");
            await this.app.vault.modify(sourceFile, updatedContent);
          } else {
            // Append ## Notes section at end
            const updatedContent = sourceContent.trimEnd() + "\n\n" + notesHeading + "\n\n" + backlinkLine + "\n";
            await this.app.vault.modify(sourceFile, updatedContent);
          }
        }

        // Optionally add the new note to the active essay
        if (addToEssay && activeProject) {
          const noteFile = this.app.vault.getAbstractFileByPath(targetPath);
          if (noteFile instanceof TFile) {
            await this.addNoteToProject(activeProject, noteFile);
          }
        }

        new Notice(`Created "${safeName}.md"`);
      }
    ).open();
  }

  refreshView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof AssemblerView) {
        (leaf.view as AssemblerView).debouncedRender();
      }
    }
  }

  async loadPluginData() {
    const saved = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, saved);
    // Merge settings so new keys get defaults
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, saved?.settings);
  }

  async savePluginData() {
    await this.saveData(this.data);
  }
}

// ── Sidebar View ────────────────────────────────────────────

class AssemblerView extends ItemView {
  plugin: NoteAssemblerPlugin;
  private draggedIndex: number | null = null;

  debouncedRender = debounce(() => this.renderContent(), 300, true);

  constructor(leaf: WorkspaceLeaf, plugin: NoteAssemblerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Cairn";
  }

  getIcon() {
    return "layers";
  }

  async onOpen() {
    this.renderContent();
  }

  async renderContent() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("note-assembler");

    // ── Header: project selector + buttons ──
    const header = container.createDiv({ cls: "na-header" });
    const projectRow = header.createDiv({ cls: "na-project-row" });

    const select = projectRow.createEl("select", { cls: "na-project-select" });
    const projects = this.plugin.data.projects;

    if (projects.length === 0) {
      select.createEl("option", { text: "No projects", value: "" });
      select.disabled = true;
    } else {
      for (const p of projects) {
        const opt = select.createEl("option", { text: p.name, value: p.id });
        if (p.id === this.plugin.data.activeProjectId) {
          opt.selected = true;
        }
      }
    }

    select.addEventListener("change", async () => {
      this.plugin.data.activeProjectId = select.value || null;
      await this.plugin.savePluginData();
      this.renderContent();
      this.plugin.updateProjectFileClass();
    });

    const btnGroup = projectRow.createDiv({ cls: "na-btn-group" });

    const newBtn = btnGroup.createEl("button", {
      cls: "na-btn na-btn-icon",
      attr: { "aria-label": "New project" },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", () => {
      const modal = new NewProjectModal(this.app, async (name) => {
        // Ensure modal is fully removed before async work triggers re-renders
        modal.close();
        await sleep(100);
        const filePath = `${name}.md`;
        // Create the file if it doesn't exist
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (!existing) {
          await this.app.vault.create(filePath, "");
        }
        const project: Project = {
          id: generateId(),
          name,
          filePath,
          sourceFolder: "",
        };
        this.plugin.data.projects.push(project);
        this.plugin.data.activeProjectId = project.id;
        await this.plugin.savePluginData();
        this.renderContent();
      });
      modal.open();
    });

    const untrackBtn = btnGroup.createEl("button", {
      cls: "na-btn na-btn-icon na-btn-danger",
      attr: { "aria-label": "Untrack project" },
    });
    setIcon(untrackBtn, "unlink");

    const openBtn = header.createEl("button", {
      cls: "na-btn na-btn-primary na-open-essay",
      text: "Open Essay",
    });
    setIcon(openBtn.createSpan({ cls: "na-open-essay-icon" }), "file-text");
    openBtn.addEventListener("click", async () => {
      const proj = this.plugin.getActiveProject();
      if (!proj) return;
      const pFile = this.app.vault.getAbstractFileByPath(proj.filePath);
      if (!(pFile instanceof TFile)) return;
      const openLeaves = this.app.workspace.getLeavesOfType("markdown");
      const existing = openLeaves.find((leaf) => {
        const v = leaf.view as any;
        return v?.file?.path === pFile.path;
      });
      if (existing) {
        this.app.workspace.revealLeaf(existing);
      } else {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(pFile);
      }
    });
    untrackBtn.addEventListener("click", async () => {
      const project = this.plugin.getActiveProject();
      if (!project) return;
      if (!confirm(`Untrack "${project.name}"? Your essay note stays in your vault — Cairn just stops managing it.`))
        return;
      this.plugin.untrackProject(project.id);
    });

    const project = this.plugin.getActiveProject();

    // ── Action buttons ──
    const actions = header.createDiv({ cls: "na-actions" });

    const addBtn = actions.createEl("button", {
      cls: "na-btn na-btn-primary",
      text: "Add Note",
    });
    addBtn.disabled = !project;
    addBtn.addEventListener("click", async () => {
      if (!project) return;
      const pFile = this.app.vault.getAbstractFileByPath(project.filePath);
      const headings = new Set<string>();
      if (pFile instanceof TFile) {
        const c = await this.plugin.getFileContent(pFile);
        for (const s of this.plugin.parseSections(c)) {
          headings.add(s.heading);
        }
      }
      new NoteSuggestModal(this.app, project, headings, this.plugin, (file) => {
        this.plugin.addNoteToProject(project, file);
      }).open();
    });

    const blankBtn = actions.createEl("button", {
      cls: "na-btn na-btn-primary",
      text: "Add Section",
    });
    blankBtn.disabled = !project;
    blankBtn.addEventListener("click", () => {
      if (!project) return;
      this.plugin.addBlankSection(project);
    });

    const exportBtn = actions.createEl("button", {
      cls: "na-btn",
      text: "Export Final Essay",
    });
    exportBtn.disabled = !project;
    exportBtn.setAttribute("title", "Export final essay to clipboard (wikilinks stripped)");
    exportBtn.addEventListener("click", () => {
      if (!project) return;
      this.plugin.copyCleanExport(project);
    });

    // ── Section list from file ──
    if (!project) {
      const emptyDiv = container.createDiv({ cls: "na-empty" });
      emptyDiv.createSpan({
        text: 'Create a project with "+" to get started.',
      });
      if (this.plugin.data.projects.length === 0) {
        emptyDiv.createEl("br");
        emptyDiv.createEl("br");
        const sampleBtn = emptyDiv.createEl("button", {
          cls: "na-btn na-btn-primary",
          text: "Try the sample project",
        });
        sampleBtn.addEventListener("click", () => {
          this.plugin.createSampleProject();
        });
        emptyDiv.createEl("br");
        emptyDiv.createEl("br");
        emptyDiv.createSpan({
          cls: "na-empty-hint",
          text: "A guided tour of Cairn's features, built as a real project.",
        });
      }
      return;
    }

    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) {
      container.createDiv({
        cls: "na-empty",
        text: `File "${project.filePath}" not found.`,
      });
      return;
    }

    // Read content and parse sections
    const content = await this.plugin.getFileContent(projectFile);
    const allSections = this.plugin.parseSections(content);
    const draggable = allSections.filter((s) => !s.pinned);
    const pinned = allSections.filter((s) => s.pinned);

    if (draggable.length === 0 && pinned.length === 0) {
      container.createDiv({
        cls: "na-empty",
        text: 'No sections yet. Click "Add Note" to pull in a note, or "Add Section" for a blank section.',
      });
      return;
    }

    // Word count (non-pinned sections only)
    const contentLines = content.split("\n");
    let essayText = "";
    for (const section of draggable) {
      essayText += contentLines.slice(section.startLine + 1, section.endLine).join(" ") + " ";
    }
    const wordCount = essayText.trim().split(/\s+/).filter((w) => w.length > 0).length;
    container.createDiv({ cls: "na-word-count", text: `${wordCount} words` });

    const list = container.createDiv({ cls: "na-note-list" });

    draggable.forEach((section, index) => {
      const card = list.createDiv({ cls: "na-note-card" });
      card.setAttribute("draggable", "true");
      card.dataset.index = String(index);

      // Drag handle
      const grip = card.createSpan({ cls: "na-grip" });
      setIcon(grip, "grip-vertical");

      // Number
      card.createSpan({ cls: "na-note-num", text: `${index + 1}.` });

      // Title — click to scroll to section in editor
      const title = card.createSpan({
        cls: "na-note-title",
        text: truncate(section.heading, 40),
      });
      title.setAttribute("title", section.heading);

      // Per-section word count
      const sectionText = contentLines.slice(section.startLine + 1, section.endLine).join(" ").trim();
      const sectionWords = sectionText.split(/\s+/).filter((w) => w.length > 0).length;
      card.createSpan({ cls: "na-section-wc", text: `${sectionWords}` });

      title.addEventListener("click", () => {
        // Scroll to section in editor
        const leaves = this.app.workspace.getLeavesOfType("markdown");
        for (const leaf of leaves) {
          const view = leaf.view as any;
          if (view?.file?.path === project.filePath && view?.editor) {
            view.editor.setCursor({ line: section.startLine, ch: 0 });
            view.editor.scrollIntoView(
              {
                from: { line: section.startLine, ch: 0 },
                to: { line: Math.min(section.startLine + 5, section.endLine), ch: 0 },
              },
              true
            );
            this.app.workspace.revealLeaf(leaf);
            break;
          }
        }
      });

      // Move buttons
      const moveGroup = card.createSpan({ cls: "na-move-group" });
      const upBtn = moveGroup.createSpan({ cls: "na-move" });
      setIcon(upBtn, "chevron-up");
      upBtn.setAttribute("title", "Move up");
      if (index === 0) upBtn.addClass("na-move-disabled");
      upBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (index > 0) await this.plugin.moveSection(project, index, index - 1);
      });
      const downBtn = moveGroup.createSpan({ cls: "na-move" });
      setIcon(downBtn, "chevron-down");
      downBtn.setAttribute("title", "Move down");
      if (index === draggable.length - 1) downBtn.addClass("na-move-disabled");
      downBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (index < draggable.length - 1) await this.plugin.moveSection(project, index, index + 1);
      });

      // Extract button
      const extractBtn = card.createSpan({ cls: "na-extract" });
      setIcon(extractBtn, "arrow-up-right");
      extractBtn.setAttribute("title", "Extract to standalone note");
      extractBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.plugin.extractSection(project, index);
      });

      // Remove button
      const removeBtn = card.createSpan({ cls: "na-remove" });
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.plugin.removeSection(project, index);
      });

      // ── Drag events ──
      card.addEventListener("dragstart", (e) => {
        this.draggedIndex = index;
        card.addClass("na-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
        }
      });

      card.addEventListener("dragend", () => {
        this.draggedIndex = null;
        card.removeClass("na-dragging");
        list
          .querySelectorAll(".na-drop-above, .na-drop-below")
          .forEach((el) => {
            el.removeClass("na-drop-above");
            el.removeClass("na-drop-below");
          });
      });

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (this.draggedIndex === null || this.draggedIndex === index) return;
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "move";
        }
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        list
          .querySelectorAll(".na-drop-above, .na-drop-below")
          .forEach((el) => {
            el.removeClass("na-drop-above");
            el.removeClass("na-drop-below");
          });
        if (e.clientY < midY) {
          card.addClass("na-drop-above");
        } else {
          card.addClass("na-drop-below");
        }
      });

      card.addEventListener("dragleave", () => {
        card.removeClass("na-drop-above");
        card.removeClass("na-drop-below");
      });

      card.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (this.draggedIndex === null || this.draggedIndex === index) return;

        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        const fromIndex = this.draggedIndex;
        let toIndex = index;

        if (fromIndex < index) {
          toIndex--;
        }
        if (!insertBefore) {
          toIndex++;
        }

        this.draggedIndex = null;
        await this.plugin.moveSection(project, fromIndex, toIndex);
      });
    });

    // Show pinned sections (Sources) as non-draggable
    for (const section of pinned) {
      const card = list.createDiv({ cls: "na-note-card na-pinned" });
      const pinnedGrip = card.createSpan({ cls: "na-grip na-grip-disabled" });
      setIcon(pinnedGrip, "grip-vertical");
      card.createSpan({ cls: "na-note-num", text: "" });
      const title = card.createSpan({
        cls: "na-note-title na-pinned-title",
        text: section.heading,
      });
      title.addEventListener("click", () => {
        const leaves = this.app.workspace.getLeavesOfType("markdown");
        for (const leaf of leaves) {
          const view = leaf.view as any;
          if (view?.file?.path === project.filePath && view?.editor) {
            view.editor.setCursor({ line: section.startLine, ch: 0 });
            view.editor.scrollIntoView(
              {
                from: { line: section.startLine, ch: 0 },
                to: { line: Math.min(section.startLine + 5, section.endLine), ch: 0 },
              },
              true
            );
            this.app.workspace.revealLeaf(leaf);
            break;
          }
        }
      });
    }

    // ── Related Notes (follow-links) ──
    const lines = content.split("\n");
    const allWikilinks: string[] = [];
    for (const section of draggable) {
      const sectionContent = lines.slice(section.startLine, section.endLine).join("\n");
      for (const link of parseWikilinks(sectionContent)) {
        if (!allWikilinks.includes(link)) {
          allWikilinks.push(link);
        }
      }
    }

    // Resolve to files, filter out already-present and project file
    const existingHeadings = new Set(allSections.map((s) => s.heading));
    const suggestions: TFile[] = [];
    for (const linkTarget of allWikilinks) {
      if (suggestions.length >= this.plugin.data.settings.maxRelatedNotes) break;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(linkTarget, project.filePath);
      if (!resolved) continue;
      if (resolved.path === project.filePath) continue;
      if (existingHeadings.has(resolved.basename)) continue;
      suggestions.push(resolved);
    }

    if (suggestions.length > 0) {
      const relatedContainer = container.createDiv({ cls: "na-related" });
      relatedContainer.createDiv({ cls: "na-related-header", text: "Related Notes" });

      for (const file of suggestions) {
        const row = relatedContainer.createDiv({ cls: "na-related-item" });
        row.createSpan({ cls: "na-related-name", text: file.basename });
        const addBtn = row.createSpan({ cls: "na-related-add" });
        setIcon(addBtn, "plus");
        addBtn.setAttribute("title", `Add "${file.basename}" to project`);
        addBtn.addEventListener("click", async () => {
          await this.plugin.addNoteToProject(project, file);
        });
      }
    }
  }
}

// ── Fuzzy Search Modal ──────────────────────────────────────

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  project: Project;
  existingHeadings: Set<string>;
  onChoose: (file: TFile) => void;
  private activeFolder: string;
  private plugin: NoteAssemblerPlugin;

  constructor(app: App, project: Project, existingHeadings: Set<string>, plugin: NoteAssemblerPlugin, onChoose: (file: TFile) => void) {
    super(app);
    this.project = project;
    this.existingHeadings = existingHeadings;
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.activeFolder = project.sourceFolder || "";
    this.setPlaceholder("Search for a note to add...");
  }

  onOpen() {
    super.onOpen();
    // Add folder picker above the search input
    const folderRow = this.modalEl.createDiv({ cls: "na-modal-folder-row" });
    this.modalEl.prepend(folderRow);

    folderRow.createSpan({ cls: "na-folder-label", text: "Main Source:" });
    const folderSelect = folderRow.createEl("select", { cls: "na-folder-select" });
    folderSelect.createEl("option", { text: "All folders", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", { text: folder, value: folder });
      if (folder === this.activeFolder) opt.selected = true;
    }

    folderSelect.addEventListener("change", async () => {
      this.activeFolder = folderSelect.value;
      // Persist the choice back to the project
      this.project.sourceFolder = folderSelect.value;
      await this.plugin.savePluginData();
      // Re-trigger the fuzzy search with updated items
      (this as any).updateSuggestions();
    });
  }

  getItems(): TFile[] {
    const folder = this.activeFolder;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => {
        if (f.path === this.project.filePath) return false;
        if (folder && !f.path.startsWith(folder + "/")) return false;
        if (this.existingHeadings.has(f.basename)) return false;
        return true;
      });
  }

  getItemText(item: TFile): string {
    return item.basename;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}

// ── New Project Modal ───────────────────────────────────────

class NewProjectModal extends Modal {
  onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "New Essay" });

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "na-modal-input",
      placeholder: "What's your argument? (e.g. Growth is killing Moab's character)",
    });
    input.focus();

    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        new Notice("Project name cannot be empty");
        return;
      }
      this.onSubmit(name);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const createBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: "Create",
    });
    createBtn.addEventListener("click", submit);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Extract Modal ───────────────────────────────────────────

class ExtractModal extends Modal {
  onSubmit: (folder: string) => void;
  noteName: string;
  defaultFolder: string;

  constructor(app: App, noteName: string, defaultFolder: string, onSubmit: (folder: string) => void) {
    super(app);
    this.noteName = noteName;
    this.defaultFolder = defaultFolder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Extract to Note" });
    contentEl.createEl("p", {
      text: `${this.noteName}.md`,
      cls: "na-extract-filename",
    });

    const folderSelect = contentEl.createEl("select", { cls: "na-modal-input" });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", { text: folder, value: folder });
      if (folder === this.defaultFolder) opt.selected = true;
    }

    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const extractBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Extract" });
    extractBtn.addEventListener("click", () => {
      this.close();
      this.onSubmit(folderSelect.value);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Extract Selection Modal ─────────────────────────────────

class ExtractSelectionModal extends Modal {
  onSubmit: (noteName: string, folder: string) => void;
  defaultFolder: string;

  constructor(app: App, defaultFolder: string, onSubmit: (noteName: string, folder: string) => void) {
    super(app);
    this.defaultFolder = defaultFolder;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Extract Selection to Note" });

    const input = contentEl.createEl("input", {
      type: "text",
      cls: "na-modal-input",
      placeholder: "Note name",
    });
    input.focus();

    const folderSelect = contentEl.createEl("select", { cls: "na-modal-input" });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", { text: folder, value: folder });
      if (folder === this.defaultFolder) opt.selected = true;
    }

    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        new Notice("Note name cannot be empty");
        return;
      }
      this.close();
      this.onSubmit(name, folderSelect.value);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const extractBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Extract" });
    extractBtn.addEventListener("click", submit);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Distill Highlight Modal ──────────────────────────────────

class DistillModal extends Modal {
  quote: string;
  metadata: SourceMetadata;
  highlightMatch: HighlightMatch | null;
  sourceFile: TFile;
  defaultFolder: string;
  activeProjectName: string | null;
  onSubmit: (idea: string, title: string, folder: string, addToEssay: boolean) => void;

  constructor(
    app: App,
    quote: string,
    metadata: SourceMetadata,
    highlightMatch: HighlightMatch | null,
    sourceFile: TFile,
    defaultFolder: string,
    activeProjectName: string | null,
    onSubmit: (idea: string, title: string, folder: string, addToEssay: boolean) => void
  ) {
    super(app);
    this.quote = quote;
    this.metadata = metadata;
    this.highlightMatch = highlightMatch;
    this.sourceFile = sourceFile;
    this.defaultFolder = defaultFolder;
    this.activeProjectName = activeProjectName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Distill Highlight" });

    // Source info line
    let sourceText = this.metadata.title || this.sourceFile.basename;
    if (this.metadata.author) {
      sourceText += ` by ${this.metadata.author}`;
    }
    contentEl.createDiv({ cls: "fl-source-info", text: sourceText });

    // Quote display
    const quoteEl = contentEl.createDiv({ cls: "fl-quote" });
    quoteEl.setText(this.quote);

    // Idea textarea
    const textarea = contentEl.createEl("textarea", {
      cls: "fl-idea-textarea",
      placeholder: "What does this mean to you?",
    });

    // Title input
    const titleInput = contentEl.createEl("input", {
      type: "text",
      cls: "fl-title-input",
      placeholder: "Note title",
    });

    // Auto-suggest title from idea (debounced)
    let titleManuallyEdited = false;
    titleInput.addEventListener("input", () => {
      titleManuallyEdited = true;
    });

    const updateTitle = debounce(() => {
      if (titleManuallyEdited) return;
      const ideaText = textarea.value.trim();
      if (ideaText) {
        const suggested = ideaText.length > 60
          ? ideaText.substring(0, 60).replace(/\s+\S*$/, "")
          : ideaText;
        titleInput.value = suggested;
      }
    }, 500, true);

    textarea.addEventListener("input", () => {
      updateTitle();
    });

    // Folder select
    const folderSelect = contentEl.createEl("select", { cls: "na-modal-input" });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", { text: folder, value: folder });
      if (folder === this.defaultFolder) opt.selected = true;
    }

    // Add to essay checkbox (only shown when a project is active)
    let addToEssayCheckbox: HTMLInputElement | null = null;
    if (this.activeProjectName) {
      const checkRow = contentEl.createDiv({ cls: "fl-check-row" });
      addToEssayCheckbox = checkRow.createEl("input", { type: "checkbox" });
      addToEssayCheckbox.id = "fl-add-to-essay";
      addToEssayCheckbox.checked = true;
      const label = checkRow.createEl("label", {
        text: `Add to "${this.activeProjectName}"`,
      });
      label.setAttr("for", "fl-add-to-essay");
    }

    // Button row
    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = btnRow.createEl("button", { cls: "mod-cta", text: "Create Note" });

    const submit = () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("Note title cannot be empty");
        return;
      }
      this.close();
      this.onSubmit(textarea.value, title, folderSelect.value, addToEssayCheckbox?.checked ?? false);
    };

    createBtn.addEventListener("click", submit);

    // Enter in title field submits (Shift+Enter in textarea is newline, Enter alone doesn't submit there)
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    // Focus textarea after render
    setTimeout(() => textarea.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ── Settings Tab ────────────────────────────────────────────

class NoteAssemblerSettingTab extends PluginSettingTab {
  plugin: NoteAssemblerPlugin;

  constructor(app: App, plugin: NoteAssemblerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Cairn — Essay Composer" });

    new Setting(containerEl)
      .setName("Pinned section name")
      .setDesc("The heading that stays pinned at the bottom (e.g. Sources, Bibliography, References)")
      .addText((text) =>
        text
          .setPlaceholder("Sources")
          .setValue(this.plugin.data.settings.pinnedSectionName)
          .onChange(async (value) => {
            this.plugin.data.settings.pinnedSectionName = value || "Sources";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Max related notes")
      .setDesc("Maximum number of suggestions shown in the Related Notes panel")
      .addSlider((slider) =>
        slider
          .setLimits(2, 12, 1)
          .setValue(this.plugin.data.settings.maxRelatedNotes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.data.settings.maxRelatedNotes = value;
            await this.plugin.savePluginData();
          })
      );

    // ── Export settings ──
    containerEl.createEl("h3", { text: "Export" });

    new Setting(containerEl)
      .setName("Include headings in export")
      .setDesc("When off, section headings (## lines) are stripped from the exported essay")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.exportIncludeHeadings)
          .onChange(async (value) => {
            this.plugin.data.settings.exportIncludeHeadings = value;
            await this.plugin.savePluginData();
          })
      );

    // ── Distill settings ──
    containerEl.createEl("h3", { text: "Distill" });

    new Setting(containerEl)
      .setName("Default folder for distilled notes")
      .setDesc("Where new notes from Distill Highlight are saved")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Vault root");
        const folders: string[] = [];
        this.app.vault.getAllLoadedFiles().forEach((f) => {
          if (f.children !== undefined && f.path !== "/") {
            folders.push(f.path);
          }
        });
        folders.sort();
        for (const folder of folders) {
          dropdown.addOption(folder, folder);
        }
        dropdown
          .setValue(this.plugin.data.settings.distillDefaultFolder)
          .onChange(async (value) => {
            this.plugin.data.settings.distillDefaultFolder = value;
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("Add backlink to source file")
      .setDesc("After creating a note, append a link to it under a ## Notes section in the source file")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.addBacklinkToSource)
          .onChange(async (value) => {
            this.plugin.data.settings.addBacklinkToSource = value;
            await this.plugin.savePluginData();
          })
      );

    // Donation / about section
    containerEl.createEl("h3", { text: "Support" });
    const donateDesc = containerEl.createDiv({ cls: "na-settings-donate" });
    donateDesc.createSpan({
      text: "Cairn is free and open source. If it helps your writing, consider leaving a tip.",
    });
    donateDesc.createEl("br");
    const link = donateDesc.createEl("a", {
      text: "Tip on Venmo",
      href: "https://venmo.com/KiKiBouba",
    });
    link.setAttr("target", "_blank");

    containerEl.createEl("h3", { text: "About" });
    const aboutDesc = containerEl.createDiv({ cls: "na-settings-about" });
    aboutDesc.createSpan({
      text: "Built by Maggie McGuire. ",
    });
    const ghLink = aboutDesc.createEl("a", {
      text: "GitHub",
      href: "https://github.com/MaggieMcgu/obsidian-note-assembler",
    });
    ghLink.setAttr("target", "_blank");
  }
}

// ── Readwise / Distill Helpers ───────────────────────────────

interface SourceMetadata {
  title: string;
  author: string;
  url: string;
  category: string;
}

function parseSourceMetadata(content: string): SourceMetadata {
  const meta: SourceMetadata = { title: "", author: "", url: "", category: "" };

  // Title: from # H1 heading
  const h1Match = content.match(/^# (.+)$/m);
  if (h1Match) {
    meta.title = h1Match[1].trim();
  }

  // Look for ## Metadata section
  const metadataStart = content.indexOf("## Metadata");
  if (metadataStart !== -1) {
    const metadataEnd = content.indexOf("\n## ", metadataStart + 1);
    const metadataBlock = metadataEnd !== -1
      ? content.slice(metadataStart, metadataEnd)
      : content.slice(metadataStart);

    // Full Title (overrides H1 if present)
    const fullTitleMatch = metadataBlock.match(/^- Full Title:\s*(.+)$/m);
    if (fullTitleMatch) {
      meta.title = fullTitleMatch[1].trim();
    }

    // Author: strip [[ ]] brackets
    const authorMatch = metadataBlock.match(/^- Author:\s*(.+)$/m);
    if (authorMatch) {
      meta.author = authorMatch[1].trim().replace(/\[\[|\]\]/g, "");
    }

    // URL
    const urlMatch = metadataBlock.match(/^- URL:\s*(.+)$/m);
    if (urlMatch) {
      meta.url = urlMatch[1].trim();
    }

    // Category
    const categoryMatch = metadataBlock.match(/^- Category:\s*(.+)$/m);
    if (categoryMatch) {
      meta.category = categoryMatch[1].trim().replace(/^#/, "");
    }
  }

  return meta;
}

interface HighlightMatch {
  cleanText: string;
  linkMarkdown: string;
}

function findMatchingHighlight(selection: string, content: string): HighlightMatch | null {
  // Find ## Highlights section
  const highlightsStart = content.indexOf("## Highlights");
  if (highlightsStart === -1) return null;

  const highlightsEnd = content.indexOf("\n## ", highlightsStart + 1);
  const highlightsBlock = highlightsEnd !== -1
    ? content.slice(highlightsStart, highlightsEnd)
    : content.slice(highlightsStart);

  // Parse bullet points (handling multi-line continuation)
  const lines = highlightsBlock.split("\n");
  const bullets: string[] = [];
  let current = "";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("- ")) {
      if (current) bullets.push(current);
      current = line.slice(2);
    } else if (current && line.startsWith("  ")) {
      // Continuation line
      current += " " + line.trim();
    } else if (line.trim() === "") {
      if (current) bullets.push(current);
      current = "";
    }
  }
  if (current) bullets.push(current);

  // Normalize selection for matching (collapse whitespace)
  const normalizedSelection = selection.replace(/\s+/g, " ").trim();

  for (const bullet of bullets) {
    // Check if selection is a substring of this bullet's text
    const normalizedBullet = bullet.replace(/\s+/g, " ").trim();
    if (!normalizedBullet.includes(normalizedSelection) && !normalizedSelection.includes(normalizedBullet.replace(/\s*\(?\[.*$/, "").trim())) {
      continue;
    }

    // Extract trailing link: ([View Highlight](url)) or ([Location NNN](url))
    const linkMatch = bullet.match(/\(\[(View Highlight|Location \d+)]\((https?:\/\/[^)]+)\)\)\s*$/);
    const linkMarkdown = linkMatch ? `[${linkMatch[1]}](${linkMatch[2]})` : "";

    // Clean text: remove the trailing link portion
    let cleanText = bullet;
    if (linkMatch && linkMatch.index !== undefined) {
      cleanText = bullet.slice(0, linkMatch.index).trim();
    }
    // Also remove leading ==highlight== markers if present
    cleanText = cleanText.replace(/==/g, "");

    return { cleanText, linkMarkdown };
  }

  return null;
}

// ── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 1) + "\u2026" : str;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "").trim();
}

function parseWikilinks(content: string): string[] {
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?]]/g;
  const links: string[] = [];
  let match;
  while ((match = re.exec(content)) !== null) {
    const target = match[1].trim();
    if (target && !links.includes(target)) {
      links.push(target);
    }
  }
  return links;
}
