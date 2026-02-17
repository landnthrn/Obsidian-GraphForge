/**
 * Code block processor for display_folder_directory: render a grid of cards for files and subfolders.
 * UI matches FML: container/card/title/date classes, exclude hub and current file, sort by name, click to open.
 * Subfolders appear as cards with a folder icon; clicking opens the folder's hub note.
 */

import { Plugin, setIcon, TFile, TFolder } from "obsidian";
import { ensureHubForFolder } from "./hubContent";
import { getExpectedHubNameForFolder } from "./hubForFolder";
import { shouldSkipPath, type PathSkipOptions } from "./pathRules";
import type { HubSettings } from "./settings";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

function getFolderPath(sourcePath: string): string {
	const i = sourcePath.lastIndexOf("/");
	return i <= 0 ? "" : sourcePath.slice(0, i);
}

/** Sort key for folders/files by name. */
const byName = (a: { name: string }, b: { name: string }) =>
	a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/**
 * Register the display_folder_directory code block processor. Call from plugin onload.
 */
export function registerFolderDirectoryProcessor(
	plugin: Plugin,
	settings: HubSettings
): void {
	plugin.registerMarkdownCodeBlockProcessor(
		"display_folder_directory",
		async (_source, el, ctx) => {
			const sourcePath = ctx.sourcePath;
			if (!sourcePath) return;
			const folderPath = getFolderPath(sourcePath);
			const vault = plugin.app.vault;
			const folder = folderPath ? vault.getFolderByPath(folderPath) : vault.getRoot();
			if (!folder || !(folder instanceof TFolder)) return;
			const options = pathSkipFromSettings(settings);
			const expectedHubName = await getExpectedHubNameForFolder(vault, folder, settings);
			const files: TFile[] = [];
			const folders: TFolder[] = [];
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					if (child.name.startsWith(".")) continue;
					if (shouldSkipPath(child.path, options)) continue;
					folders.push(child);
					continue;
				}
				if (!(child instanceof TFile) || child.extension !== "md") continue;
				if (child.path === sourcePath) continue;
				if (child.basename === expectedHubName) continue;
				if (child.basename.startsWith(".")) continue;
				if (shouldSkipPath(child.path, options)) continue;
				files.push(child);
			}
			folders.sort(byName);
			files.sort(byName);
			const hasItems = folders.length > 0 || files.length > 0;
			const container = el.createDiv({ cls: "folder-directory-container" });
			if (!hasItems) {
				container.createDiv({ text: "No notes or folders in this folder." });
				return;
			}
			// Render folder cards first
			for (const subfolder of folders) {
				const hubName = await getExpectedHubNameForFolder(vault, subfolder, settings);
				const hubPath = subfolder.path + "/" + hubName + ".md";
				const card = container.createDiv({
					cls: "folder-directory-card folder-directory-card-folder",
				});
				const link = card.createEl("a", {
					cls: "folder-directory-card-link",
					href: hubPath,
					attr: { "data-href": hubPath },
				});
				const header = link.createDiv({ cls: "folder-directory-card-header" });
				const iconWrap = header.createDiv({ cls: "folder-directory-card-icon" });
				setIcon(iconWrap, "folder");
				header.createDiv({ cls: "folder-directory-card-title", text: subfolder.name });
				link.createDiv({ cls: "folder-directory-card-subtitle", text: "Folder" });
				link.onclick = (e) => {
					e.preventDefault();
					void (async () => {
						await ensureHubForFolder(vault, subfolder, settings);
						await plugin.app.workspace.openLinkText(hubPath.replace(/\.md$/, ""), sourcePath, false);
					})();
				};
			}
			// Render note cards
			for (const file of files) {
				const card = container.createDiv({ cls: "folder-directory-card" });
				const link = card.createEl("a", {
					cls: "folder-directory-card-link",
					href: file.path,
					attr: { "data-href": file.path },
				});
				link.createDiv({ cls: "folder-directory-card-title", text: file.basename });
				if (file.stat?.mtime) {
					const d = new Date(file.stat.mtime);
					const dateStr = d.toLocaleDateString();
					const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
					link.createDiv({
						cls: "folder-directory-card-date",
						text: `${dateStr}, ${timeStr}`,
					});
				}
				link.onclick = (e) => {
					e.preventDefault();
					const linkText = file.path.replace(/\.md$/, "");
					void plugin.app.workspace.openLinkText(linkText, sourcePath, false);
				};
			}
		}
	);
}
