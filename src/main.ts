import {
  App,
  FuzzySuggestModal,
  ItemView,
  Menu,
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

interface ProjectSource {
  notePath: string;
  addedAt: number;
  status: "unread" | "active" | "done";
}

interface Project {
  id: string;
  name: string;
  filePath: string;
  sourceFolder: string; // vault-relative folder path, "" = all
  sources: ProjectSource[];
}

interface NoteAssemblerSettings {
  pinnedSectionName: string;
  maxRelatedNotes: number;
  distillDefaultFolder: string;
  addBacklinkToSource: boolean;
  exportIncludeHeadings: boolean;
  showProjectsInDistill: boolean;
}

const DEFAULT_SETTINGS: NoteAssemblerSettings = {
  pinnedSectionName: "Sources",
  maxRelatedNotes: 6,
  distillDefaultFolder: "",
  addBacklinkToSource: false,
  exportIncludeHeadings: true,
  showProjectsInDistill: true,
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
      name: "Add current note to project sources",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const project = this.getActiveProject();
        if (!file || !project) return false;
        if (file.path === project.filePath) return false;
        if (checking) return true;
        this.addSourceToQueue(project, file);
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

    // Right-click context menu in editors
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

    // Right-click context menu in file tree — "Send to sources"
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const projects = this.data.projects.filter(
          (p) => p.filePath !== file.path
        );
        if (projects.length === 0) return;

        menu.addSeparator();
        for (const project of projects) {
          menu.addItem((item) => {
            item
              .setTitle(`→ ${project.name} sources`)
              .setIcon("layers")
              .onClick(() => this.addSourceToQueue(project, file));
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
      if (this.data.projects.length > 0) {
        this.activateView();
      }
      setTimeout(() => this.updateProjectFileClass(), 100);
    });
  }

  onunload() {
    document.querySelectorAll(".cairn-project-file").forEach((el) => {
      el.classList.remove("cairn-project-file");
    });
  }

  updateProjectFileClass() {
    document.querySelectorAll(".cairn-project-file").forEach((el) => {
      el.classList.remove("cairn-project-file");
    });
    const project = this.getActiveProject();
    if (!project) return;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const file = (leaf.view as any)?.file;
      if (file && file.path === project.filePath) {
        leaf.view.containerEl.classList.add("cairn-project-file");
        break;
      }
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

  // ── Source Queue Methods ──

  async addSourceToQueue(project: Project, sourceFile: TFile) {
    if (project.sources.some((s) => s.notePath === sourceFile.path)) {
      new Notice(`"${sourceFile.basename}" is already in sources`);
      return;
    }
    if (sourceFile.path === project.filePath) {
      new Notice("Can't add the project file as a source");
      return;
    }
    project.sources.push({
      notePath: sourceFile.path,
      addedAt: Date.now(),
      status: "unread",
    });
    await this.savePluginData();
    // Auto-open preview for the newly added source
    const newIndex = project.sources.length - 1;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof AssemblerView) {
        (leaf.view as AssemblerView).previewSourceIndex = newIndex;
      }
    }
    this.refreshView();
    new Notice(`Added "${sourceFile.basename}" to sources — click actions below to add to essay`);
  }

  async removeSourceFromQueue(project: Project, sourceIndex: number) {
    if (sourceIndex >= 0 && sourceIndex < project.sources.length) {
      project.sources.splice(sourceIndex, 1);
      await this.savePluginData();
      this.refreshView();
    }
  }

  async markSourceStatus(
    project: Project,
    sourceIndex: number,
    status: "unread" | "active" | "done"
  ) {
    if (sourceIndex >= 0 && sourceIndex < project.sources.length) {
      project.sources[sourceIndex].status = status;
      await this.savePluginData();
      this.refreshView();
    }
  }

  async addSourceAsIs(project: Project, source: ProjectSource) {
    const sourceFile = this.app.vault.getAbstractFileByPath(source.notePath);
    if (!(sourceFile instanceof TFile)) return;
    await this.addNoteToProject(project, sourceFile);
    const idx = project.sources.findIndex(
      (s) => s.notePath === source.notePath
    );
    if (idx >= 0 && project.sources[idx].status === "unread") {
      project.sources[idx].status = "active";
      await this.savePluginData();
    }
    this.switchToTab("outline");
  }

  async distillSource(project: Project, source: ProjectSource) {
    const sourceFile = this.app.vault.getAbstractFileByPath(source.notePath);
    if (!(sourceFile instanceof TFile)) return;
    let sourceContent = await this.app.vault.read(sourceFile);
    sourceContent = sourceContent.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    const preview =
      sourceContent.length > 500
        ? sourceContent.substring(0, 500) + "\u2026"
        : sourceContent;
    this.distillHighlight(preview, sourceFile);
    const idx = project.sources.findIndex(
      (s) => s.notePath === source.notePath
    );
    if (idx >= 0 && project.sources[idx].status === "unread") {
      project.sources[idx].status = "active";
      await this.savePluginData();
    }
  }

  async quoteSelectionFromSource(
    project: Project,
    source: ProjectSource,
    selection: string
  ) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;
    const sourceFile = this.app.vault.getAbstractFileByPath(source.notePath);
    if (!(sourceFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);

    const trimmed = selection.trim();
    const headingText =
      trimmed.length > 60
        ? trimmed.substring(0, 60).replace(/\s+\S*$/, "") + "\u2026"
        : trimmed.split("\n")[0];
    const heading = headingText.replace(/[#|[\]]/g, "");

    const blockquote = trimmed
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const sourceName = sourceFile.basename;
    const newSection = `## ${heading}\n\n${blockquote}\n[[${sourceName}|*]]\n`;

    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines
        .slice(0, sourcesSection.startLine)
        .join("\n");
      const sourcesText = lines.slice(sourcesSection.startLine).join("\n");
      const updatedSources = sourcesText.includes(`[[${sourceName}]]`)
        ? sourcesText
        : sourcesText.trimEnd() + `\n- [[${sourceName}]]`;
      newContent =
        beforeSources.trimEnd() +
        "\n\n" +
        newSection +
        "\n" +
        updatedSources +
        "\n";
    } else {
      const pinnedName = this.data.settings.pinnedSectionName;
      newContent =
        content.trimEnd() +
        "\n\n" +
        newSection +
        `\n\n---\n\n## ${pinnedName}\n\n- [[${sourceName}]]\n`;
    }

    await this.setFileContent(projectFile, newContent);

    const idx = project.sources.findIndex(
      (s) => s.notePath === source.notePath
    );
    if (idx >= 0 && project.sources[idx].status === "unread") {
      project.sources[idx].status = "active";
      await this.savePluginData();
    }

    this.switchToTab("outline");
    new Notice(`Quoted to outline as "## ${heading}"`);
  }

  async distillSelectionFromSource(
    project: Project,
    source: ProjectSource,
    selection: string
  ) {
    const sourceFile = this.app.vault.getAbstractFileByPath(source.notePath);
    if (!(sourceFile instanceof TFile)) return;
    this.distillHighlight(selection, sourceFile);
    const idx = project.sources.findIndex(
      (s) => s.notePath === source.notePath
    );
    if (idx >= 0 && project.sources[idx].status === "unread") {
      project.sources[idx].status = "active";
      await this.savePluginData();
    }
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

  // ── Add a vault note as a new section (with [[source|*]] attribution) ──

  async addNoteToProject(project: Project, sourceFile: TFile) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    let sourceContent = await this.app.vault.read(sourceFile);
    sourceContent = sourceContent.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const headingPattern = new RegExp(
      `^#\\s+${escapeRegex(sourceFile.basename)}\\s*\n?`
    );
    sourceContent = sourceContent.replace(headingPattern, "").trim();

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);

    const quoted = sourceContent
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const newSection = `## ${sourceFile.basename}\n\n${quoted}\n[[${sourceFile.basename}|*]]\n`;

    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines
        .slice(0, sourcesSection.startLine)
        .join("\n");
      const sourcesText = lines.slice(sourcesSection.startLine).join("\n");
      const updatedSources =
        sourcesText.trimEnd() + `\n- [[${sourceFile.basename}]]`;
      newContent =
        beforeSources.trimEnd() +
        "\n\n" +
        newSection +
        "\n" +
        updatedSources +
        "\n";
    } else {
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
    new Notice(`Added "## ${sourceFile.basename}" to outline`);
  }

  // ── Add a blank section ──

  async addBlankSection(project: Project) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);
    const newSection = "## New Section\n\n";

    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines
        .slice(0, sourcesSection.startLine)
        .join("\n");
      const sourcesText = lines.slice(sourcesSection.startLine).join("\n");
      newContent =
        beforeSources.trimEnd() + "\n\n" + newSection + "\n" + sourcesText;
    } else {
      newContent = content.trimEnd() + "\n\n" + newSection;
    }

    await this.setFileContent(projectFile, newContent);

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
    const draggable = allSections.filter((s) => !s.pinned);
    if (fromIndex >= draggable.length || toIndex >= draggable.length) return;

    const lines = content.split("\n");
    const section = draggable[fromIndex];
    const sectionLines = lines.slice(section.startLine, section.endLine);

    lines.splice(section.startLine, section.endLine - section.startLine);

    const afterRemoval = lines.join("\n");
    const remainingSections = this.parseSections(afterRemoval).filter(
      (s) => !s.pinned
    );

    let insertLine: number;
    if (toIndex >= remainingSections.length) {
      const pinned = this.parseSections(afterRemoval).find((s) => s.pinned);
      insertLine = pinned ? pinned.startLine : lines.length;
    } else {
      insertLine = remainingSections[toIndex].startLine;
    }

    while (
      sectionLines.length > 0 &&
      sectionLines[sectionLines.length - 1].trim() === ""
    ) {
      sectionLines.pop();
    }

    const before = lines.slice(0, insertLine);
    const after = lines.slice(insertLine);

    while (before.length > 0 && before[before.length - 1].trim() === "") {
      before.pop();
    }

    const parts: string[] = [];
    if (before.length > 0) {
      parts.push(before.join("\n"));
    }
    parts.push(sectionLines.join("\n"));
    if (after.length > 0) {
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
    lines.splice(section.startLine, section.endLine - section.startLine);

    const newContent =
      lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd() + "\n";
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

    const bodyLines = lines.slice(section.startLine + 1, section.endLine);
    while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === "")
      bodyLines.pop();

    if (bodyLines.length === 0) {
      new Notice("Cannot extract an empty section");
      return;
    }

    const safeName = sanitizeFilename(section.heading);

    new ExtractModal(
      this.app,
      safeName,
      project.sourceFolder || "",
      async (folder) => {
        const targetPath = folder
          ? `${folder}/${safeName}.md`
          : `${safeName}.md`;

        if (this.app.vault.getAbstractFileByPath(targetPath)) {
          new Notice(`File "${targetPath}" already exists`);
          return;
        }

        await this.app.vault.create(targetPath, bodyLines.join("\n") + "\n");

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
          const newContent =
            content.trimEnd() +
            `\n\n---\n\n## ${pinnedName}\n\n` +
            `- [[${safeName}]]` +
            "\n";
          await this.setFileContent(projectFile, newContent);
        }

        new Notice(`Extracted "${section.heading}" to ${targetPath}`);
      }
    ).open();
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
        sectionLines = sectionLines.filter((l) => !l.match(/^## .+$/));
      }
      parts.push(sectionLines.join("\n"));
    }

    let output = parts.join("\n\n");
    // Strip source attribution links: [[note|*]] → empty
    output = output.replace(/\[\[[^\]|]+\|\*]]/g, "");
    // Strip remaining wikilinks: [[Target|Display]] → Display, [[Target]] → Target
    output = output.replace(/\[\[([^\]|]+)\|([^\]]+)]]/g, "$2");
    output = output.replace(/\[\[([^\]]+)]]/g, "$1");
    // Clean up excess blank lines
    output = output.replace(/\n{3,}/g, "\n\n").trim();

    await navigator.clipboard.writeText(output);
    const wordCount = output
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    new Notice(`Copied to clipboard (${wordCount} words)`);

    setTimeout(() => {
      if (
        confirm(
          `Essay exported. Untrack "${project.name}"? The file stays in your vault.`
        )
      ) {
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

    const sampleContent = `# Cairn — Getting Started

## What you're looking at

This is a sample project — a real Cairn essay built with the plugin's own features. The sidebar on the right shows two sections: **Sources** (notes you've collected) and **Outline** (your essay structure).

**Try it now:** Click any card in the Outline to jump to that section.

## The source queue workflow

In v0.4, notes go through a **source queue** before entering your essay:

1. **Collect** — Right-click any note → "Send to sources", or drag from the file tree
2. **Browse** — Click a source in the sidebar to preview it
3. **Pull** — Select text → right-click → "Quote selection" or "Distill selection"
4. **Write** — Hit "Open Essay" and write the connective tissue

The key insight: your sources stay separate from your writing until you deliberately pull something in.

## Pulling in content

From the source preview, you have four options:

- **Quote selection** — select text, right-click → instant blockquote with [[source|*]] attribution
- **Distill selection** — select text, right-click → write what it means to you
- **Add as-is** — dump the whole note as a blockquote (for already-distilled notes)
- **Distill first** — process the whole note through the Distill modal

## What to do next

1. **Create your own essay** — Click **+** in the sidebar
2. **Collect some sources** — Right-click notes in your vault → "Send to sources"
3. **Browse and pull** — Click sources, select quotes, build your argument

## Sources

- [[Cairn Documentation]]
`;

    await this.app.vault.create(filePath, sampleContent);

    const project: Project = {
      id: generateId(),
      name: "Cairn — Getting Started",
      filePath,
      sourceFolder: "",
      sources: [],
    };
    this.data.projects.push(project);
    this.data.activeProjectId = project.id;
    await this.savePluginData();
    this.refreshView();

    const newFile = this.app.vault.getAbstractFileByPath(filePath);
    if (newFile instanceof TFile) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(newFile);
    }
  }

  // ── Extract selection to a new note ──

  async extractSelectionToNote(project: Project, selection: string) {
    const defaultFolder = project.sourceFolder || "";

    new ExtractSelectionModal(
      this.app,
      defaultFolder,
      async (noteName, folder) => {
        const safeName = sanitizeFilename(noteName);
        if (!safeName) {
          new Notice("Note name cannot be empty");
          return;
        }

        const targetPath = folder
          ? `${folder}/${safeName}.md`
          : `${safeName}.md`;

        if (this.app.vault.getAbstractFileByPath(targetPath)) {
          new Notice(`File "${targetPath}" already exists`);
          return;
        }

        await this.app.vault.create(targetPath, selection.trim() + "\n");

        const projectFile = this.app.vault.getAbstractFileByPath(
          project.filePath
        );
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
            const newContent =
              content.trimEnd() +
              `\n\n---\n\n## ${pinnedName}\n\n` +
              `- [[${safeName}]]` +
              "\n";
            await this.setFileContent(projectFile, newContent);
          }
        }

        new Notice(`Created "${safeName}.md" from selection`);
      }
    ).open();
  }

  // ── Add selected text directly as a section in the essay ──

  async addSelectionToEssay(
    project: Project,
    selection: string,
    sourceFile: TFile
  ) {
    const projectFile = this.app.vault.getAbstractFileByPath(project.filePath);
    if (!(projectFile instanceof TFile)) return;

    const content = await this.getFileContent(projectFile);
    const sections = this.parseSections(content);

    const trimmed = selection.trim();
    const headingText =
      trimmed.length > 60
        ? trimmed.substring(0, 60).replace(/\s+\S*$/, "") + "\u2026"
        : trimmed.split("\n")[0];
    const heading = "Quote: " + headingText.replace(/[#|[\]]/g, "");

    const blockquote = trimmed
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const sourceName = sourceFile.basename;
    const newSection = `## ${heading}\n\n${blockquote}\n[[${sourceName}|*]]\n`;

    const sourcesSection = sections.find((s) => s.pinned);
    const lines = content.split("\n");

    let newContent: string;
    if (sourcesSection) {
      const beforeSources = lines
        .slice(0, sourcesSection.startLine)
        .join("\n");
      const sourcesText = lines.slice(sourcesSection.startLine).join("\n");
      const updatedSources = sourcesText.includes(`[[${sourceName}]]`)
        ? sourcesText
        : sourcesText.trimEnd() + `\n- [[${sourceName}]]`;
      newContent =
        beforeSources.trimEnd() +
        "\n\n" +
        newSection +
        "\n" +
        updatedSources +
        "\n";
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

    new DistillModal(
      this.app,
      selection,
      metadata,
      highlightMatch,
      sourceFile,
      defaultFolder,
      this.data.settings.showProjectsInDistill ? this.data.projects : [],
      this.data.activeProjectId,
      async (idea, title, folder, selectedProjectIds) => {
        const safeName = sanitizeFilename(title);
        if (!safeName) {
          new Notice("Note title cannot be empty");
          return;
        }

        const targetPath = folder
          ? `${folder}/${safeName}.md`
          : `${safeName}.md`;

        if (this.app.vault.getAbstractFileByPath(targetPath)) {
          new Notice(`File "${targetPath}" already exists`);
          return;
        }

        const quoteText = highlightMatch
          ? highlightMatch.cleanText
          : selection.trim();
        const lines: string[] = [];

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

        if (this.data.settings.addBacklinkToSource) {
          const sourceContent = await this.app.vault.read(sourceFile);
          const notesHeading = "## Notes";
          const backlinkLine = `- [[${safeName}]]`;

          if (sourceContent.includes(notesHeading)) {
            const notesIdx = sourceContent.indexOf(notesHeading);
            const afterHeading = notesIdx + notesHeading.length;
            const nextSection = sourceContent.indexOf(
              "\n## ",
              afterHeading
            );
            const insertPos =
              nextSection !== -1 ? nextSection : sourceContent.length;
            const updatedContent =
              sourceContent.slice(0, insertPos).trimEnd() +
              "\n" +
              backlinkLine +
              "\n" +
              (nextSection !== -1
                ? "\n" + sourceContent.slice(nextSection + 1)
                : "");
            await this.app.vault.modify(sourceFile, updatedContent);
          } else {
            const updatedContent =
              sourceContent.trimEnd() +
              "\n\n" +
              notesHeading +
              "\n\n" +
              backlinkLine +
              "\n";
            await this.app.vault.modify(sourceFile, updatedContent);
          }
        }

        if (selectedProjectIds.length > 0) {
          const noteFile =
            this.app.vault.getAbstractFileByPath(targetPath);
          if (noteFile instanceof TFile) {
            for (const projId of selectedProjectIds) {
              const proj = this.data.projects.find((p) => p.id === projId);
              if (proj) {
                await this.addNoteToProject(proj, noteFile);
              }
            }
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

  switchToTab(tab: "sources" | "outline") {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof AssemblerView) {
        (leaf.view as AssemblerView).activeTab = tab;
      }
    }
  }

  async loadPluginData() {
    const saved = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, saved);
    this.data.settings = Object.assign({}, DEFAULT_SETTINGS, saved?.settings);
    // Ensure sources array exists on all projects (backwards compat)
    for (const project of this.data.projects) {
      if (!project.sources) {
        project.sources = [];
      }
    }
  }

  async savePluginData() {
    await this.saveData(this.data);
  }
}

// ── Sidebar View ────────────────────────────────────────────

class AssemblerView extends ItemView {
  plugin: NoteAssemblerPlugin;
  private draggedIndex: number | null = null;
  previewSourceIndex: number | null = null;
  activeTab: "sources" | "outline" = "sources";

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
      this.previewSourceIndex = null;
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
        modal.close();
        await sleep(100);
        const filePath = `${name}.md`;
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (!existing) {
          await this.app.vault.create(filePath, "");
        }
        const project: Project = {
          id: generateId(),
          name,
          filePath,
          sourceFolder: "",
          sources: [],
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
    untrackBtn.addEventListener("click", async () => {
      const project = this.plugin.getActiveProject();
      if (!project) return;
      if (
        !confirm(
          `Untrack "${project.name}"? Your essay note stays in your vault — Cairn just stops managing it.`
        )
      )
        return;
      this.plugin.untrackProject(project.id);
    });

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

    const project = this.plugin.getActiveProject();

    // ── Empty state ──
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

    // ── Tab bar ──
    const tabBar = container.createDiv({ cls: "na-tab-bar" });

    const sourcesTab = tabBar.createEl("button", {
      cls:
        "na-tab" + (this.activeTab === "sources" ? " na-tab-active" : ""),
      text: `Sources${project.sources.length > 0 ? ` (${project.sources.length})` : ""}`,
    });
    sourcesTab.addEventListener("click", () => {
      this.activeTab = "sources";
      this.renderContent();
    });

    const outlineTab = tabBar.createEl("button", {
      cls:
        "na-tab" + (this.activeTab === "outline" ? " na-tab-active" : ""),
      text: "Outline",
    });
    outlineTab.addEventListener("click", () => {
      this.activeTab = "outline";
      this.renderContent();
    });

    // ── Active tab content ──
    if (this.activeTab === "sources") {
      await this.renderSourcesSection(container, project);
    } else {
      await this.renderOutlineSection(container, project, projectFile);
    }
  }

  // ── Sources Section ──

  private async renderSourcesSection(
    container: HTMLElement,
    project: Project
  ) {
    const section = container.createDiv({ cls: "na-sources-section" });

    // Section header
    const sectionHeader = section.createDiv({ cls: "na-section-header" });
    sectionHeader.createSpan({
      cls: "na-section-label",
      text: `SOURCES (${project.sources.length})`,
    });

    // Source list (also a drop target)
    const list = section.createDiv({ cls: "na-source-list" });

    // Drop target for file tree drag
    list.addEventListener("dragover", (e) => {
      // Only accept external drags (from file tree), not our own section drags
      if (this.draggedIndex !== null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      list.addClass("na-drop-target-active");
    });
    list.addEventListener("dragleave", () => {
      list.removeClass("na-drop-target-active");
    });
    list.addEventListener("drop", async (e) => {
      if (this.draggedIndex !== null) return;
      e.preventDefault();
      list.removeClass("na-drop-target-active");
      const dragData = (this.app as any).dragManager?.draggable;
      if (dragData?.type === "file" && dragData.file instanceof TFile) {
        await this.plugin.addSourceToQueue(project, dragData.file);
      } else if (dragData?.type === "files") {
        for (const file of dragData.files) {
          if (file instanceof TFile) {
            await this.plugin.addSourceToQueue(project, file);
          }
        }
      }
    });

    if (project.sources.length === 0) {
      list.createDiv({
        cls: "na-source-empty",
        text: "Drag notes here, or right-click a note → Send to sources",
      });
    } else {
      // Clamp preview index
      if (
        this.previewSourceIndex !== null &&
        this.previewSourceIndex >= project.sources.length
      ) {
        this.previewSourceIndex = null;
      }

      for (let i = 0; i < project.sources.length; i++) {
        const source = project.sources[i];
        const sourceFile = this.app.vault.getAbstractFileByPath(
          source.notePath
        );
        const isPreviewed = this.previewSourceIndex === i;

        const card = list.createDiv({
          cls:
            "na-source-card" +
            (source.status === "done" ? " na-source-done" : "") +
            (isPreviewed ? " na-source-active" : ""),
        });

        // Status indicator (click to toggle done)
        const statusIcon = card.createSpan({ cls: "na-source-status" });
        if (source.status === "done") {
          setIcon(statusIcon, "check-circle");
        } else if (source.status === "active") {
          setIcon(statusIcon, "circle-dot");
        } else {
          setIcon(statusIcon, "circle");
        }
        statusIcon.addEventListener("click", (e) => {
          e.stopPropagation();
          const newStatus = source.status === "done" ? "unread" : "done";
          this.plugin.markSourceStatus(project, i, newStatus);
        });

        // Title (click to toggle preview)
        const title = card.createSpan({
          cls: "na-source-title",
          text:
            sourceFile?.basename ||
            source.notePath.split("/").pop() ||
            "Unknown",
        });
        const idx = i;
        title.addEventListener("click", () => {
          if (this.previewSourceIndex === idx) {
            this.previewSourceIndex = null;
          } else {
            this.previewSourceIndex = idx;
          }
          this.renderContent();
        });

        // Remove button
        const removeBtn = card.createSpan({ cls: "na-source-remove" });
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.previewSourceIndex === idx) {
            this.previewSourceIndex = null;
          } else if (
            this.previewSourceIndex !== null &&
            this.previewSourceIndex > idx
          ) {
            this.previewSourceIndex--;
          }
          this.plugin.removeSourceFromQueue(project, idx);
        });
      }
    }

    // Preview panel
    if (
      this.previewSourceIndex !== null &&
      this.previewSourceIndex < project.sources.length
    ) {
      const source = project.sources[this.previewSourceIndex];
      const sourceFile = this.app.vault.getAbstractFileByPath(source.notePath);

      if (sourceFile instanceof TFile) {
        const previewContainer = section.createDiv({
          cls: "na-source-preview",
        });

        // Preview header (click title to open note in editor)
        const previewHeader = previewContainer.createDiv({
          cls: "na-preview-header",
        });
        const previewTitle = previewHeader.createSpan({
          cls: "na-preview-title",
          text: sourceFile.basename,
        });
        previewTitle.addEventListener("click", async () => {
          const leaf = this.app.workspace.getLeaf("tab");
          await leaf.openFile(sourceFile);
        });

        // Preview body (selectable text)
        let previewContent = await this.app.vault.read(sourceFile);
        previewContent = previewContent
          .replace(/^---\n[\s\S]*?\n---\n?/, "")
          .trim();

        const previewBody = previewContainer.createDiv({
          cls: "na-preview-body",
        });
        previewBody.setText(previewContent);

        // Right-click on selected text → Quote / Distill
        const capturedSource = source;
        previewBody.addEventListener("contextmenu", (e) => {
          const sel = window.getSelection()?.toString()?.trim();
          if (!sel) return;

          e.preventDefault();
          const menu = new Menu();

          menu.addItem((item) => {
            item
              .setTitle("\u2192 Quote to essay")
              .setIcon("quote")
              .onClick(() => {
                this.plugin.quoteSelectionFromSource(
                  project,
                  capturedSource,
                  sel
                );
              });
          });

          menu.addItem((item) => {
            item
              .setTitle("\u2192 Distill to essay")
              .setIcon("sparkles")
              .onClick(() => {
                this.plugin.distillSelectionFromSource(
                  project,
                  capturedSource,
                  sel
                );
              });
          });

          menu.showAtMouseEvent(e);
        });

        // Whole-note action buttons
        const previewActions = previewContainer.createDiv({
          cls: "na-preview-actions",
        });

        const addAsIsBtn = previewActions.createEl("button", {
          cls: "na-btn",
          text: "\u2192 Add to essay",
        });
        addAsIsBtn.addEventListener("click", () => {
          this.plugin.addSourceAsIs(project, capturedSource);
        });

        const distillBtn = previewActions.createEl("button", {
          cls: "na-btn",
          text: "\u2192 Distill to essay",
        });
        distillBtn.addEventListener("click", () => {
          this.plugin.distillSource(project, capturedSource);
        });
      }
    }

    // Add Source button
    const addSourceBtn = section.createEl("button", {
      cls: "na-btn na-add-source-btn",
      text: "+ Add Source",
    });
    addSourceBtn.addEventListener("click", () => {
      const existingPaths = new Set(project.sources.map((s) => s.notePath));
      new SourceSuggestModal(
        this.app,
        project,
        existingPaths,
        this.plugin,
        (file) => {
          this.plugin.addSourceToQueue(project, file);
        }
      ).open();
    });
  }

  // ── Outline Section ──

  private async renderOutlineSection(
    container: HTMLElement,
    project: Project,
    projectFile: TFile
  ) {
    const section = container.createDiv({ cls: "na-outline-section" });

    // Section header
    const sectionHeader = section.createDiv({ cls: "na-section-header" });
    sectionHeader.createSpan({ cls: "na-section-label", text: "OUTLINE" });

    // Read content and parse sections
    const content = await this.plugin.getFileContent(projectFile);
    const allSections = this.plugin.parseSections(content);
    const draggable = allSections.filter((s) => !s.pinned);
    const pinned = allSections.filter((s) => s.pinned);

    if (draggable.length === 0 && pinned.length === 0) {
      section.createDiv({
        cls: "na-empty na-outline-empty",
        text: "No sections yet. Add sources and pull content in, or add a blank section.",
      });
    } else {
      // Word count
      const contentLines = content.split("\n");
      let essayText = "";
      for (const sec of draggable) {
        essayText +=
          contentLines.slice(sec.startLine + 1, sec.endLine).join(" ") + " ";
      }
      const wordCount = essayText
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
      section.createDiv({
        cls: "na-word-count",
        text: `${wordCount} words`,
      });

      const list = section.createDiv({ cls: "na-note-list" });

      draggable.forEach((sec, index) => {
        const card = list.createDiv({ cls: "na-note-card" });
        card.setAttribute("draggable", "true");
        card.dataset.index = String(index);

        const grip = card.createSpan({ cls: "na-grip" });
        setIcon(grip, "grip-vertical");

        card.createSpan({ cls: "na-note-num", text: `${index + 1}.` });

        const title = card.createSpan({
          cls: "na-note-title",
          text: sec.heading,
        });
        title.setAttribute("title", sec.heading);

        // Per-section word count
        const sectionText = contentLines
          .slice(sec.startLine + 1, sec.endLine)
          .join(" ")
          .trim();
        const sectionWords = sectionText
          .split(/\s+/)
          .filter((w) => w.length > 0).length;
        card.createSpan({
          cls: "na-section-wc",
          text: `${sectionWords}`,
        });

        title.addEventListener("click", () => {
          this.scrollToSection(project, sec);
        });

        // Move buttons
        const moveGroup = card.createSpan({ cls: "na-move-group" });
        const upBtn = moveGroup.createSpan({ cls: "na-move" });
        setIcon(upBtn, "chevron-up");
        upBtn.setAttribute("title", "Move up");
        if (index === 0) upBtn.addClass("na-move-disabled");
        upBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (index > 0)
            await this.plugin.moveSection(project, index, index - 1);
        });
        const downBtn = moveGroup.createSpan({ cls: "na-move" });
        setIcon(downBtn, "chevron-down");
        downBtn.setAttribute("title", "Move down");
        if (index === draggable.length - 1)
          downBtn.addClass("na-move-disabled");
        downBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (index < draggable.length - 1)
            await this.plugin.moveSection(project, index, index + 1);
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

      // Pinned sections (Sources)
      for (const sec of pinned) {
        const card = list.createDiv({ cls: "na-note-card na-pinned" });
        const pinnedGrip = card.createSpan({
          cls: "na-grip na-grip-disabled",
        });
        setIcon(pinnedGrip, "grip-vertical");
        card.createSpan({ cls: "na-note-num", text: "" });
        const title = card.createSpan({
          cls: "na-note-title na-pinned-title",
          text: sec.heading,
        });
        title.addEventListener("click", () => {
          this.scrollToSection(project, sec);
        });
      }
    }

    // Action buttons
    const actions = section.createDiv({ cls: "na-actions" });

    const blankBtn = actions.createEl("button", {
      cls: "na-btn",
      text: "Add Section",
    });
    blankBtn.addEventListener("click", () => {
      this.plugin.addBlankSection(project);
    });

    const exportBtn = actions.createEl("button", {
      cls: "na-btn",
      text: "Export Final Essay",
    });
    exportBtn.setAttribute(
      "title",
      "Export final essay to clipboard (wikilinks and [[source|*]] stripped)"
    );
    exportBtn.addEventListener("click", () => {
      this.plugin.copyCleanExport(project);
    });

    // ── Related Notes ──
    const fileContent = await this.plugin.getFileContent(projectFile);
    const allSects = this.plugin.parseSections(fileContent);
    const draggableSects = allSects.filter((s) => !s.pinned);
    const lines = fileContent.split("\n");
    const allWikilinks: string[] = [];
    for (const sec of draggableSects) {
      const sectionContent = lines
        .slice(sec.startLine, sec.endLine)
        .join("\n");
      for (const link of parseWikilinks(sectionContent)) {
        if (!allWikilinks.includes(link)) {
          allWikilinks.push(link);
        }
      }
    }

    const existingHeadings = new Set(allSects.map((s) => s.heading));
    const existingSourcePaths = new Set(
      project.sources.map((s) => s.notePath)
    );
    const suggestions: TFile[] = [];
    for (const linkTarget of allWikilinks) {
      if (suggestions.length >= this.plugin.data.settings.maxRelatedNotes)
        break;
      const resolved = this.app.metadataCache.getFirstLinkpathDest(
        linkTarget,
        project.filePath
      );
      if (!resolved) continue;
      if (resolved.path === project.filePath) continue;
      if (existingHeadings.has(resolved.basename)) continue;
      if (existingSourcePaths.has(resolved.path)) continue;
      suggestions.push(resolved);
    }

    if (suggestions.length > 0) {
      const relatedContainer = container.createDiv({ cls: "na-related" });
      relatedContainer.createDiv({
        cls: "na-related-header",
        text: "Related Notes",
      });

      for (const file of suggestions) {
        const row = relatedContainer.createDiv({ cls: "na-related-item" });
        row.createSpan({ cls: "na-related-name", text: file.basename });
        const addBtn = row.createSpan({ cls: "na-related-add" });
        setIcon(addBtn, "plus");
        addBtn.setAttribute(
          "title",
          `Add "${file.basename}" to source queue`
        );
        addBtn.addEventListener("click", async () => {
          await this.plugin.addSourceToQueue(project, file);
        });
      }
    }
  }

  private scrollToSection(project: Project, section: Section) {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.file?.path === project.filePath && view?.editor) {
        view.editor.setCursor({ line: section.startLine, ch: 0 });
        view.editor.scrollIntoView(
          {
            from: { line: section.startLine, ch: 0 },
            to: {
              line: Math.min(section.startLine + 5, section.endLine),
              ch: 0,
            },
          },
          true
        );
        this.app.workspace.revealLeaf(leaf);
        break;
      }
    }
  }
}

// ── Source Suggest Modal (for Add Source) ────────────────────

class SourceSuggestModal extends FuzzySuggestModal<TFile> {
  project: Project;
  existingPaths: Set<string>;
  onChoose: (file: TFile) => void;
  private activeFolder: string;
  private plugin: NoteAssemblerPlugin;

  constructor(
    app: App,
    project: Project,
    existingPaths: Set<string>,
    plugin: NoteAssemblerPlugin,
    onChoose: (file: TFile) => void
  ) {
    super(app);
    this.project = project;
    this.existingPaths = existingPaths;
    this.plugin = plugin;
    this.onChoose = onChoose;
    this.activeFolder = project.sourceFolder || "";
    this.setPlaceholder("Search for a note to add to sources...");
  }

  onOpen() {
    super.onOpen();
    const folderRow = this.modalEl.createDiv({ cls: "na-modal-folder-row" });
    this.modalEl.prepend(folderRow);

    folderRow.createSpan({ cls: "na-folder-label", text: "Folder:" });
    const folderSelect = folderRow.createEl("select", {
      cls: "na-folder-select",
    });
    folderSelect.createEl("option", { text: "All folders", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", {
        text: folder,
        value: folder,
      });
      if (folder === this.activeFolder) opt.selected = true;
    }

    folderSelect.addEventListener("change", async () => {
      this.activeFolder = folderSelect.value;
      this.project.sourceFolder = folderSelect.value;
      await this.plugin.savePluginData();
      (this as any).updateSuggestions();
    });
  }

  getItems(): TFile[] {
    const folder = this.activeFolder;
    return this.app.vault.getMarkdownFiles().filter((f) => {
      if (f.path === this.project.filePath) return false;
      if (folder && !f.path.startsWith(folder + "/")) return false;
      if (this.existingPaths.has(f.path)) return false;
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

// ── Note Suggest Modal (for Add Note — legacy, used by distill) ──

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
  project: Project;
  existingHeadings: Set<string>;
  onChoose: (file: TFile) => void;
  private activeFolder: string;
  private plugin: NoteAssemblerPlugin;

  constructor(
    app: App,
    project: Project,
    existingHeadings: Set<string>,
    plugin: NoteAssemblerPlugin,
    onChoose: (file: TFile) => void
  ) {
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
    const folderRow = this.modalEl.createDiv({ cls: "na-modal-folder-row" });
    this.modalEl.prepend(folderRow);

    folderRow.createSpan({ cls: "na-folder-label", text: "Main Source:" });
    const folderSelect = folderRow.createEl("select", {
      cls: "na-folder-select",
    });
    folderSelect.createEl("option", { text: "All folders", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", {
        text: folder,
        value: folder,
      });
      if (folder === this.activeFolder) opt.selected = true;
    }

    folderSelect.addEventListener("change", async () => {
      this.activeFolder = folderSelect.value;
      this.project.sourceFolder = folderSelect.value;
      await this.plugin.savePluginData();
      (this as any).updateSuggestions();
    });
  }

  getItems(): TFile[] {
    const folder = this.activeFolder;
    return this.app.vault.getMarkdownFiles().filter((f) => {
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
      placeholder:
        "What's your argument? (e.g. Growth is killing Moab's character)",
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

  constructor(
    app: App,
    noteName: string,
    defaultFolder: string,
    onSubmit: (folder: string) => void
  ) {
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

    const folderSelect = contentEl.createEl("select", {
      cls: "na-modal-input",
    });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", {
        text: folder,
        value: folder,
      });
      if (folder === this.defaultFolder) opt.selected = true;
    }

    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const extractBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: "Extract",
    });
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

  constructor(
    app: App,
    defaultFolder: string,
    onSubmit: (noteName: string, folder: string) => void
  ) {
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

    const folderSelect = contentEl.createEl("select", {
      cls: "na-modal-input",
    });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", {
        text: folder,
        value: folder,
      });
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
    const extractBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: "Extract",
    });
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
  projects: Project[];
  activeProjectId: string | null;
  onSubmit: (
    idea: string,
    title: string,
    folder: string,
    selectedProjectIds: string[]
  ) => void;

  constructor(
    app: App,
    quote: string,
    metadata: SourceMetadata,
    highlightMatch: HighlightMatch | null,
    sourceFile: TFile,
    defaultFolder: string,
    projects: Project[],
    activeProjectId: string | null,
    onSubmit: (
      idea: string,
      title: string,
      folder: string,
      selectedProjectIds: string[]
    ) => void
  ) {
    super(app);
    this.quote = quote;
    this.metadata = metadata;
    this.highlightMatch = highlightMatch;
    this.sourceFile = sourceFile;
    this.defaultFolder = defaultFolder;
    this.projects = projects;
    this.activeProjectId = activeProjectId;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Distill Highlight" });

    let sourceText = this.metadata.title || this.sourceFile.basename;
    if (this.metadata.author) {
      sourceText += ` by ${this.metadata.author}`;
    }
    contentEl.createDiv({ cls: "fl-source-info", text: sourceText });

    const quoteEl = contentEl.createDiv({ cls: "fl-quote" });
    quoteEl.setText(this.quote);

    const textarea = contentEl.createEl("textarea", {
      cls: "fl-idea-textarea",
      placeholder: "What does this mean to you?",
    });

    const titleInput = contentEl.createEl("input", {
      type: "text",
      cls: "fl-title-input",
      placeholder: "Note title",
    });

    let titleManuallyEdited = false;
    titleInput.addEventListener("input", () => {
      titleManuallyEdited = true;
    });

    const updateTitle = debounce(
      () => {
        if (titleManuallyEdited) return;
        const ideaText = textarea.value.trim();
        if (ideaText) {
          const suggested =
            ideaText.length > 60
              ? ideaText.substring(0, 60).replace(/\s+\S*$/, "")
              : ideaText;
          titleInput.value = suggested;
        }
      },
      500,
      true
    );

    textarea.addEventListener("input", () => {
      updateTitle();
    });

    const folderSelect = contentEl.createEl("select", {
      cls: "na-modal-input",
    });
    folderSelect.createEl("option", { text: "Vault root", value: "" });

    const folders: string[] = [];
    this.app.vault.getAllLoadedFiles().forEach((f) => {
      if (f.children !== undefined && f.path !== "/") {
        folders.push(f.path);
      }
    });
    folders.sort();
    for (const folder of folders) {
      const opt = folderSelect.createEl("option", {
        text: folder,
        value: folder,
      });
      if (folder === this.defaultFolder) opt.selected = true;
    }

    const projectCheckboxes: Map<string, HTMLInputElement> = new Map();
    if (this.projects.length > 0) {
      const projectSection = contentEl.createDiv({
        cls: "fl-project-section",
      });
      projectSection.createEl("label", {
        cls: "fl-project-label",
        text: "Add to essays:",
      });
      for (const project of this.projects) {
        const checkRow = projectSection.createDiv({ cls: "fl-check-row" });
        const cb = checkRow.createEl("input", { type: "checkbox" });
        cb.id = `fl-project-${project.id}`;
        cb.checked = project.id === this.activeProjectId;
        const label = checkRow.createEl("label", { text: project.name });
        label.setAttr("for", cb.id);
        projectCheckboxes.set(project.id, cb);
      }
    }

    const btnRow = contentEl.createDiv({ cls: "na-modal-buttons" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());

    const createBtn = btnRow.createEl("button", {
      cls: "mod-cta",
      text: "Create Note",
    });

    const submit = () => {
      const title = titleInput.value.trim();
      if (!title) {
        new Notice("Note title cannot be empty");
        return;
      }
      const selectedIds: string[] = [];
      projectCheckboxes.forEach((cb, id) => {
        if (cb.checked) selectedIds.push(id);
      });
      this.close();
      this.onSubmit(textarea.value, title, folderSelect.value, selectedIds);
    };

    createBtn.addEventListener("click", submit);

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

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
      .setDesc(
        "The heading that stays pinned at the bottom (e.g. Sources, Bibliography, References)"
      )
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
      .setDesc(
        "Maximum number of suggestions shown in the Related Notes panel"
      )
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

    containerEl.createEl("h3", { text: "Export" });

    new Setting(containerEl)
      .setName("Include headings in export")
      .setDesc(
        "When off, section headings (## lines) are stripped from the exported essay"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.exportIncludeHeadings)
          .onChange(async (value) => {
            this.plugin.data.settings.exportIncludeHeadings = value;
            await this.plugin.savePluginData();
          })
      );

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
      .setDesc(
        "After creating a note, append a link to it under a ## Notes section in the source file"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.addBacklinkToSource)
          .onChange(async (value) => {
            this.plugin.data.settings.addBacklinkToSource = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Show essay projects in Distill")
      .setDesc(
        "Show project checkboxes when distilling a highlight. Disable if you only use Distill without essays."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.showProjectsInDistill)
          .onChange(async (value) => {
            this.plugin.data.settings.showProjectsInDistill = value;
            await this.plugin.savePluginData();
          })
      );

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
  const meta: SourceMetadata = {
    title: "",
    author: "",
    url: "",
    category: "",
  };

  const h1Match = content.match(/^# (.+)$/m);
  if (h1Match) {
    meta.title = h1Match[1].trim();
  }

  const metadataStart = content.indexOf("## Metadata");
  if (metadataStart !== -1) {
    const metadataEnd = content.indexOf("\n## ", metadataStart + 1);
    const metadataBlock =
      metadataEnd !== -1
        ? content.slice(metadataStart, metadataEnd)
        : content.slice(metadataStart);

    const fullTitleMatch = metadataBlock.match(/^- Full Title:\s*(.+)$/m);
    if (fullTitleMatch) {
      meta.title = fullTitleMatch[1].trim();
    }

    const authorMatch = metadataBlock.match(/^- Author:\s*(.+)$/m);
    if (authorMatch) {
      meta.author = authorMatch[1].trim().replace(/\[\[|\]\]/g, "");
    }

    const urlMatch = metadataBlock.match(/^- URL:\s*(.+)$/m);
    if (urlMatch) {
      meta.url = urlMatch[1].trim();
    }

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

function findMatchingHighlight(
  selection: string,
  content: string
): HighlightMatch | null {
  const highlightsStart = content.indexOf("## Highlights");
  if (highlightsStart === -1) return null;

  const highlightsEnd = content.indexOf("\n## ", highlightsStart + 1);
  const highlightsBlock =
    highlightsEnd !== -1
      ? content.slice(highlightsStart, highlightsEnd)
      : content.slice(highlightsStart);

  const lines = highlightsBlock.split("\n");
  const bullets: string[] = [];
  let current = "";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("- ")) {
      if (current) bullets.push(current);
      current = line.slice(2);
    } else if (current && line.startsWith("  ")) {
      current += " " + line.trim();
    } else if (line.trim() === "") {
      if (current) bullets.push(current);
      current = "";
    }
  }
  if (current) bullets.push(current);

  const normalizedSelection = selection.replace(/\s+/g, " ").trim();

  for (const bullet of bullets) {
    const normalizedBullet = bullet.replace(/\s+/g, " ").trim();
    if (
      !normalizedBullet.includes(normalizedSelection) &&
      !normalizedSelection.includes(
        normalizedBullet.replace(/\s*\(?\[.*$/, "").trim()
      )
    ) {
      continue;
    }

    const linkMatch = bullet.match(
      /\(\[(View Highlight|Location \d+)]\((https?:\/\/[^)]+)\)\)\s*$/
    );
    const linkMarkdown = linkMatch
      ? `[${linkMatch[1]}](${linkMatch[2]})`
      : "";

    let cleanText = bullet;
    if (linkMatch && linkMatch.index !== undefined) {
      cleanText = bullet.slice(0, linkMatch.index).trim();
    }
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
  return (
    Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
  );
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
