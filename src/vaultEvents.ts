/**
 * Vault event handlers for real-time updates. Delegate to same logic as Build/Refresh.
 * Only event handlers check realTimeUpdating; Build/Refresh and startup never do.
 * If suffix changed since last refresh, first run full migration (same as Build/Refresh) then continue.
 */

import { Plugin, TFile, TFolder, Vault } from "obsidian";
import {
	buildRefreshHubNotes,
	ensureHubContentUpToDate,
	ensureHubForFolder,
	handleDuplicateFolderNames,
} from "./hubContent";
import { buildRefreshHubLinks } from "./linksInNotes";
import {
	findHubInFolder,
	findHubInFolderWithName,
	getExpectedHubNameForFolder,
	getFoldersWithSameName,
} from "./hubForFolder";
import { isRootFolder, shouldSkipPath, type PathSkipOptions } from "./pathRules";
import type { HubSettings } from "./settings";
import { setWriteLock } from "./writeLock";
import { isWriteLocked } from "./writeLock";
import { upsertHubLinkInNote } from "./linksInNotes";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

type PluginWithSave = Plugin & { settings: HubSettings; saveSettings: () => Promise<void> };

/** If suffix changed since last refresh, run full migration (same as Build/Refresh) and return true so caller can skip normal handling. */
async function runSuffixMigrationIfNeeded(
	vault: Vault,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<boolean> {
	if (settings.hubSuffix === (settings.previousHubSuffix ?? settings.hubSuffix)) return false;
	await buildRefreshHubNotes(vault, settings);
	await buildRefreshHubLinks(vault, settings);
	await plugin.saveSettings();
	return true;
}

function getFolderNameFromPath(path: string): string {
	const segments = path.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
	return segments.pop() ?? path;
}

/** Collect all markdown files in this folder and every descendant folder. */
function getMarkdownFilesUnderFolder(folder: TFolder): TFile[] {
	const out: TFile[] = [];
	function walk(f: TFolder) {
		for (const child of f.children) {
			if (child instanceof TFile && child.extension === "md") out.push(child);
			if (child instanceof TFolder) walk(child);
		}
	}
	walk(folder);
	return out;
}

/** After numbering changes for a folder name, refresh hub links in every note under every folder with that name. */
async function refreshLinksInNotesForFolderName(
	vault: Vault,
	folderName: string,
	settings: HubSettings
): Promise<void> {
	const options = pathSkipFromSettings(settings);
	const sameName = await getFoldersWithSameName(vault, folderName, options);
	for (const folder of sameName) {
		for (const note of getMarkdownFilesUnderFolder(folder)) {
			await upsertHubLinkInNote(vault, note, settings);
		}
	}
}

/**
 * On folder create: ensure hub; run numbering for that name.
 */
async function onFolderCreate(
	vault: Vault,
	folder: TFolder,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<void> {
	if (!settings.realTimeUpdating) return;
	if (settings.autoCreateSuppressedUntilBuildRefresh) return;
	if (await runSuffixMigrationIfNeeded(vault, settings, plugin)) return;
	if (isRootFolder(folder.path)) return;
	if (shouldSkipPath(folder.path, pathSkipFromSettings(settings))) return;
	await ensureHubForFolder(vault, folder, settings);
	await handleDuplicateFolderNames(vault, folder.name, settings);
	await refreshLinksInNotesForFolderName(vault, folder.name, settings);
}

/**
 * On folder rename/move: rename hub to expected name; numbering for old and new names; ensure hub content; update subfolder hub content (parent links).
 */
async function onFolderRename(
	vault: Vault,
	folder: TFolder,
	oldPath: string,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<void> {
	if (!settings.realTimeUpdating) return;
	if (settings.autoCreateSuppressedUntilBuildRefresh) return;
	if (await runSuffixMigrationIfNeeded(vault, settings, plugin)) return;
	if (isRootFolder(folder.path)) return;
	if (shouldSkipPath(folder.path, pathSkipFromSettings(settings))) return;
	const oldFolderName = getFolderNameFromPath(oldPath);
	const expectedName = await getExpectedHubNameForFolder(vault, folder, settings);
	const hub =
		findHubInFolder(folder, settings) ??
		findHubInFolderWithName(folder, oldFolderName, settings);
	if (hub && hub.basename !== expectedName) {
		const newPath = folder.path + "/" + expectedName + ".md";
		setWriteLock(hub.path);
		setWriteLock(newPath);
		await vault.rename(hub, newPath);
	}
	await handleDuplicateFolderNames(vault, oldFolderName, settings);
	await handleDuplicateFolderNames(vault, folder.name, settings);
	await refreshLinksInNotesForFolderName(vault, oldFolderName, settings);
	await refreshLinksInNotesForFolderName(vault, folder.name, settings);
	const hubAfter = findHubInFolder(folder, settings);
	if (hubAfter) await ensureHubContentUpToDate(vault, hubAfter, folder, settings);
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			const childHub = findHubInFolder(child, settings);
			if (childHub) await ensureHubContentUpToDate(vault, childHub, child, settings);
		}
	}
	// After hub names/content are updated, refresh links in all notes under this folder (and descendants) so links stay correct on rename/move.
	for (const note of getMarkdownFilesUnderFolder(folder)) {
		await upsertHubLinkInNote(vault, note, settings);
	}
}

/**
 * On folder delete: run numbering for that folder name.
 */
async function onFolderDelete(
	vault: Vault,
	folderName: string,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<void> {
	if (!settings.realTimeUpdating) return;
	if (settings.autoCreateSuppressedUntilBuildRefresh) return;
	if (await runSuffixMigrationIfNeeded(vault, settings, plugin)) return;
	await handleDuplicateFolderNames(vault, folderName, settings);
	await refreshLinksInNotesForFolderName(vault, folderName, settings);
}

/**
 * On file create: if note, upsert hub link; if folder, folder create.
 */
async function onFileCreate(
	vault: Vault,
	file: TFile,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<void> {
	if (!settings.realTimeUpdating) return;
	if (settings.autoCreateSuppressedUntilBuildRefresh) return;
	if (await runSuffixMigrationIfNeeded(vault, settings, plugin)) return;
	if (isWriteLocked(file.path)) return;
	if (shouldSkipPath(file.path, pathSkipFromSettings(settings))) return;
	if (file.extension !== "md") return;
	await upsertHubLinkInNote(vault, file, settings);
}

/**
 * On file rename/move: note moved — upsert (or remove if at root).
 */
async function onFileRename(
	vault: Vault,
	file: TFile,
	settings: HubSettings,
	plugin: PluginWithSave
): Promise<void> {
	if (!settings.realTimeUpdating) return;
	if (settings.autoCreateSuppressedUntilBuildRefresh) return;
	if (await runSuffixMigrationIfNeeded(vault, settings, plugin)) return;
	if (isWriteLocked(file.path)) return;
	if (file.extension !== "md") return;
	await upsertHubLinkInNote(vault, file, settings);
}

/**
 * Register vault event handlers. Call from plugin onload. Uses plugin.registerEvent.
 */
export function registerVaultEvents(plugin: PluginWithSave): void {
	const vault = plugin.app.vault;
	const settings = plugin.settings;

	plugin.registerEvent(
		vault.on("create", (file) => {
			if (isWriteLocked(file.path)) return;
			if (file instanceof TFolder) {
				onFolderCreate(vault, file, settings, plugin).catch(() => {});
				return;
			}
			if (file instanceof TFile) {
				onFileCreate(vault, file, settings, plugin).catch(() => {});
			}
		})
	);

	plugin.registerEvent(
		vault.on("rename", (file, oldPath) => {
			if (file instanceof TFolder) {
				if (isWriteLocked(file.path) || isWriteLocked(oldPath)) return;
				onFolderRename(vault, file, oldPath, settings, plugin).catch(() => {});
				return;
			}
			if (file instanceof TFile) {
				onFileRename(vault, file, settings, plugin).catch(() => {});
			}
		})
	);

	plugin.registerEvent(
		vault.on("delete", (file) => {
			if (file instanceof TFolder) {
				onFolderDelete(vault, file.name, settings, plugin).catch(() => {});
			}
		})
	);
}
