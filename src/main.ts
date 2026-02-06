import {
  App,
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  debounce,
} from "obsidian";

// ── Data Model (minimal — file is the source of truth) ──────

interface Project {
  id: string;
  name: string;
  filePath: string;
  sourceFolder: string; // vault-relative folder path, "" = all
}

interface NoteAssemblerData {
  projects: Project[];
  activeProjectId: string | null;
}

const DEFAULT_DATA: NoteAssemblerData = {
  projects: [],
  activeProjectId: null,
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

    this.addRibbonIcon("layers", "Note Assembler", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-note-assembler",
      name: "Open Note Assembler",
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
      name: "Copy essay to clipboard (clean)",
      checkCallback: (checking) => {
        const project = this.getActiveProject();
        if (!project) return false;
        if (checking) return true;
        this.copyCleanExport(project);
        return true;
      },
    });

    // Watch for file changes to update sidebar
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const project = this.getActiveProject();
        if (project && file instanceof TFile && file.path === project.filePath) {
          this.refreshView();
        }
      })
    );
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
          pinned: match[1].trim() === "Sources",
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
      // No Sources section yet — add section + create Sources
      newContent =
        content.trimEnd() +
        "\n\n" +
        newSection +
        "\n\n---\n\n## Sources\n\n" +
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
        const newContent = content.trimEnd() + "\n\n---\n\n## Sources\n\n" + `- [[${safeName}]]` + "\n";
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
    const parts: string[] = [];
    for (const section of draggable) {
      const sectionLines = lines.slice(section.startLine, section.endLine);
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
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
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
    return "Note Assembler";
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
    });

    const btnGroup = projectRow.createDiv({ cls: "na-btn-group" });

    const newBtn = btnGroup.createEl("button", {
      cls: "na-btn",
      attr: { "aria-label": "New project" },
    });
    newBtn.setText("+");
    newBtn.addEventListener("click", () => {
      new NewProjectModal(this.app, async (name) => {
        const filePath = `${name}.md`;
        // Create the file if it doesn't exist
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (!existing) {
          const newFile = await this.app.vault.create(filePath, "");
          await this.app.workspace.getLeaf().openFile(newFile);
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
      }).open();
    });

    const deleteBtn = btnGroup.createEl("button", {
      cls: "na-btn na-btn-danger",
      attr: { "aria-label": "Delete project" },
    });
    deleteBtn.setText("\u00D7");
    deleteBtn.addEventListener("click", async () => {
      const project = this.plugin.getActiveProject();
      if (!project) return;
      if (!confirm(`Delete project "${project.name}"? (The file will not be deleted)`))
        return;
      this.plugin.data.projects = this.plugin.data.projects.filter(
        (p) => p.id !== project.id
      );
      this.plugin.data.activeProjectId =
        this.plugin.data.projects[0]?.id ?? null;
      await this.plugin.savePluginData();
      this.renderContent();
    });

    const project = this.plugin.getActiveProject();

    // ── Source folder selector ──
    if (project) {
      const folderRow = header.createDiv({ cls: "na-folder-row" });
      folderRow.createSpan({ cls: "na-folder-label", text: "Source:" });

      const folderSelect = folderRow.createEl("select", {
        cls: "na-folder-select",
      });
      folderSelect.createEl("option", { text: "All folders", value: "" });

      // Get all folders in the vault
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
        if (folder === (project.sourceFolder || "")) {
          opt.selected = true;
        }
      }

      // Select current value
      if (!project.sourceFolder) {
        (folderSelect.querySelector('option[value=""]') as HTMLOptionElement).selected = true;
      }

      folderSelect.addEventListener("change", async () => {
        project.sourceFolder = folderSelect.value;
        await this.plugin.savePluginData();
      });
    }

    // ── Action buttons ──
    const actions = header.createDiv({ cls: "na-actions" });

    const addBtn = actions.createEl("button", {
      cls: "na-btn na-btn-primary",
      text: "Add Note",
    });
    addBtn.disabled = !project;
    addBtn.addEventListener("click", () => {
      if (!project) return;
      new NoteSuggestModal(this.app, project, (file) => {
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
      text: "Copy Clean",
    });
    exportBtn.disabled = !project;
    exportBtn.setAttribute("title", "Copy essay to clipboard (wikilinks stripped)");
    exportBtn.addEventListener("click", () => {
      if (!project) return;
      this.plugin.copyCleanExport(project);
    });

    // ── Section list from file ──
    if (!project) {
      container.createDiv({
        cls: "na-empty",
        text: 'Create a project with "+" to get started. Pull notes from your vault into an outline. Drag to reorder. Your essay updates live.',
      });
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

    // Ensure the project file is open in the editor
    const openLeaves = this.app.workspace.getLeavesOfType("markdown");
    const alreadyOpen = openLeaves.some((leaf) => {
      const view = leaf.view as any;
      return view?.file?.path === projectFile.path;
    });
    if (!alreadyOpen) {
      await this.app.workspace.getLeaf().openFile(projectFile);
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
      card.createSpan({ cls: "na-grip", text: "\u2630" });

      // Number
      card.createSpan({ cls: "na-note-num", text: `${index + 1}.` });

      // Title — click to scroll to section in editor
      const title = card.createSpan({
        cls: "na-note-title",
        text: truncate(section.heading, 40),
      });
      title.setAttribute("title", section.heading);
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
      const upBtn = moveGroup.createSpan({ cls: "na-move", text: "\u25B2" });
      upBtn.setAttribute("title", "Move up");
      if (index === 0) upBtn.addClass("na-move-disabled");
      upBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (index > 0) await this.plugin.moveSection(project, index, index - 1);
      });
      const downBtn = moveGroup.createSpan({ cls: "na-move", text: "\u25BC" });
      downBtn.setAttribute("title", "Move down");
      if (index === draggable.length - 1) downBtn.addClass("na-move-disabled");
      downBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (index < draggable.length - 1) await this.plugin.moveSection(project, index, index + 1);
      });

      // Extract button
      const extractBtn = card.createSpan({ cls: "na-extract", text: "\u2197" });
      extractBtn.setAttribute("title", "Extract to standalone note");
      extractBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.plugin.extractSection(project, index);
      });

      // Remove button
      const removeBtn = card.createSpan({ cls: "na-remove", text: "\u00D7" });
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
      card.createSpan({ cls: "na-grip na-grip-disabled", text: "\u2630" });
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
      if (suggestions.length >= 6) break;
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
        const addBtn = row.createSpan({ cls: "na-related-add", text: "+" });
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
  onChoose: (file: TFile) => void;

  constructor(app: App, project: Project, onChoose: (file: TFile) => void) {
    super(app);
    this.project = project;
    this.onChoose = onChoose;
    this.setPlaceholder("Search for a note to add...");
  }

  getItems(): TFile[] {
    const folder = this.project.sourceFolder || "";
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => {
        if (f.path === this.project.filePath) return false;
        if (folder && !f.path.startsWith(folder + "/")) return false;
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
      this.close();
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

// ── Helpers ─────────────────────────────────────────────────

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
