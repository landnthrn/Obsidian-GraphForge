/**
 * GraphForge commands: Hide/Unhide, toggles, Insert folder directory, Ctrl+A exclude hub links.
 */

import { Editor, MarkdownView, Notice } from "obsidian";
import { CSS_CLASS_OB_HIDE } from "./constants";
import { getSelectAllExcludeLineCount } from "./linksInNotes";
import type GraphforgePlugin from "./main";
import type { HubSettings } from "./settings";

const OB_HIDE_SPAN_REGEX = new RegExp(
	`<span class="${CSS_CLASS_OB_HIDE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">([\\s\\S]*?)</span>`,
	"g"
);

function unwrapObHideInText(text: string): string {
	return text.replace(OB_HIDE_SPAN_REGEX, "$1");
}

export function registerCommands(plugin: GraphforgePlugin): void {
	const { app, settings } = plugin;

	// Hide selected text
	plugin.addCommand({
		id: "hide-selected-text",
		name: "Hide selected text",
		editorCallback: (editor: Editor) => {
			const sel = editor.getSelection();
			if (!sel) {
				new Notice("Select text first.");
				return;
			}
			editor.replaceSelection(
				`<span class="${CSS_CLASS_OB_HIDE}">${sel}</span>`
			);
		},
	});

	// Unhide in note
	plugin.addCommand({
		id: "unhide-in-note",
		name: "Unhide in note",
		editorCallback: (editor: Editor) => {
			const content = editor.getValue();
			const next = unwrapObHideInText(content);
			if (next === content) {
				new Notice("No hidden spans found in this note.");
				return;
			}
			editor.setValue(next);
			new Notice("Unhid in note.");
		},
	});

	// Unhide in vault
	plugin.addCommand({
		id: "unhide-in-vault",
		name: "Unhide in vault",
		callback: async () => {
			let count = 0;
			const files = app.vault.getMarkdownFiles();
			for (const file of files) {
				const content = await app.vault.read(file);
				const next = unwrapObHideInText(content);
				if (next !== content) {
					await app.vault.modify(file, next);
					count++;
				}
			}
			new Notice(count > 0 ? `Unhid in ${count} note(s).` : "No hidden spans found in vault.");
		},
	});

	// Toggle hide hub notes in explorer
	plugin.addCommand({
		id: "toggle-hide-hub-notes-explorer",
		name: "Toggle hide foldersuffix(#) notes in explorer",
		callback: async () => {
			settings.hideHubNotesInExplorer = !settings.hideHubNotesInExplorer;
			await plugin.saveSettings();
			plugin.refreshHideState();
			new Notice(
				settings.hideHubNotesInExplorer
					? "Hub notes are hidden."
					: "Hub notes are unhidden."
			);
		},
	});

	// Toggle auto-hide hub links
	plugin.addCommand({
		id: "toggle-auto-hide-hub-links",
		name: "Toggle hide foldersuffix(#) links in notes",
		callback: async () => {
			settings.autoHideHubLinks = !settings.autoHideHubLinks;
			await plugin.saveSettings();
			plugin.refreshHideState();
			await plugin.buildRefreshHubLinks();
			new Notice(
				settings.autoHideHubLinks
					? "Hub links in notes are hidden."
					: "Hub links in notes are unhidden."
			);
		},
	});

	// Insert folder directory display
	plugin.addCommand({
		id: "insert-folder-directory-display",
		name: "Insert folder directory display",
		editorCallback: (editor: Editor) => {
			editor.replaceSelection("```display_folder_directory\n```\n");
		},
	});

	// Ctrl+A: exclude hub links from selection when setting on
	plugin.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
		if (!settings.excludeHubLinksFromSelectAll) return;
		if (!(e.ctrlKey && e.key === "a")) return;
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		const editor = view.editor;
		const folder = view.file.parent;
		const lines = editor.getValue().split("\n");
		const skipLines = getSelectAllExcludeLineCount(lines, folder, settings);
		if (skipLines <= 0) return;
		const lineCount = lines.length;
		if (skipLines >= lineCount) {
			e.preventDefault();
			editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
			return;
		}
		e.preventDefault();
		const from = { line: skipLines, ch: 0 };
		const lastLine = lineCount - 1;
		const to = { line: lastLine, ch: lines[lastLine]?.length ?? 0 };
		editor.setSelection(from, to);
	});
}
