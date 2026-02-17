/**
 * Hub creation and content. One hub per folder; content = DIRECTORY heading, optional parent link, folder-directory block.
 */

import { App, TFile, TFolder, Vault } from "obsidian";
import {
	findHubInFolder,
	findHubInFolderWithName,
	getExpectedHubNameForFolder,
	getFoldersWithSameName,
	waitForNumberedHub,
} from "./hubForFolder";
import {
	getHubNameForFolder,
	getNumberedHubName,
	getNumberedHubPattern,
	isRootFolder,
	shouldSkipPath,
	type PathSkipOptions,
} from "./pathRules";
import type { HubSettings } from "./settings";
import { setWriteLock } from "./writeLock";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

/**
 * Build hub note content: DIRECTORY heading, optional parent link (if subfolder and setting on), folder-directory block.
 * Uses getExpectedHubNameForFolder for parent so parent link is numbered when applicable.
 */
export async function buildHubContent(
	vault: Vault,
	folder: TFolder,
	settings: HubSettings
): Promise<string> {
	const lines: string[] = [];
	lines.push(settings.hubInsertTitle || "## DIRECTORY");
	lines.push("");

	const parent = folder.parent;
	if (
		parent &&
		!parent.isRoot() &&
		settings.parentLinkForSubfolderHubs
	) {
		await waitForNumberedHub(vault, parent, settings);
		const parentHubName = await getExpectedHubNameForFolder(vault, parent, settings);
		lines.push(`[[${parentHubName}]]`);
		lines.push("");
	}

	lines.push("```display_folder_directory");
	lines.push("```");
	lines.push("");

	return lines.join("\n");
}

/**
 * Read hub, compute desired content, write if different. Single place for "wait for parent hub" when building content.
 */
export async function ensureHubContentUpToDate(
	vault: Vault,
	hubFile: TFile,
	folder: TFolder,
	settings: HubSettings
): Promise<void> {
	const desired = await buildHubContent(vault, folder, settings);
	const current = await vault.read(hubFile);
	if (current === desired) return;
	setWriteLock(hubFile.path);
	await vault.modify(hubFile, desired);
}

/**
 * Create hub file if missing; set content via buildHubContent. If hub exists, ensure content up to date.
 */
export async function ensureHubForFolder(
	vault: Vault,
	folder: TFolder,
	settings: HubSettings
): Promise<void> {
	const expectedName = await getExpectedHubNameForFolder(vault, folder, settings);
	const hub = findHubInFolder(folder, settings);
	if (hub) {
		await ensureHubContentUpToDate(vault, hub, folder, settings);
		return;
	}
	const content = await buildHubContent(vault, folder, settings);
	const path = folder.path + "/" + expectedName + ".md";
	setWriteLock(path);
	await vault.create(path, content);
}

/**
 * For a folder name with duplicates: ensure each folder has a hub with the correct numbered name (FolderName_1, _2, …). Rename or create as needed; update content.
 * When only one folder has this name: ensure its hub uses the base name (FolderName_), not a number (demote MISC_2 → MISC_).
 */
export async function assignNumberedHubsForName(
	vault: Vault,
	folderName: string,
	settings: HubSettings
): Promise<void> {
	const options = pathSkipFromSettings(settings);
	const sameName = await getFoldersWithSameName(vault, folderName, options);
	const suffix = settings.hubSuffix || "_";
	if (sameName.length <= 1) {
		if (sameName.length === 0) return;
		const folder = sameName[0];
		if (!folder) return;
		const expectedName = getHubNameForFolder(folderName, suffix);
		const hub = findHubInFolderWithName(folder, folderName, settings);
		if (hub && hub.basename !== expectedName) {
			const newPath = folder.path + "/" + expectedName + ".md";
			setWriteLock(hub.path);
			setWriteLock(newPath);
			await vault.rename(hub, newPath);
			const updated = vault.getFileByPath(newPath);
			if (updated) await ensureHubContentUpToDate(vault, updated, folder, settings);
		}
		return;
	}
	for (let i = 0; i < sameName.length; i++) {
		const folder = sameName[i];
		if (!folder) continue;
		const expectedName = getNumberedHubName(folderName, i + 1, suffix);
		const hub = findHubInFolder(folder, settings);
		if (!hub) {
			const content = await buildHubContent(vault, folder, settings);
			const path = folder.path + "/" + expectedName + ".md";
			setWriteLock(path);
			await vault.create(path, content);
			continue;
		}
		if (hub.basename !== expectedName) {
			const newPath = folder.path + "/" + expectedName + ".md";
			setWriteLock(hub.path);
			setWriteLock(newPath);
			await vault.rename(hub, newPath);
			const updated = vault.getFileByPath(newPath);
			if (updated) await ensureHubContentUpToDate(vault, updated, folder, settings);
			continue;
		}
		await ensureHubContentUpToDate(vault, hub, folder, settings);
	}
}

/**
 * Called after any change that might affect numbering (e.g. folder create/rename/delete). Runs assignNumberedHubsForName for that name.
 */
export async function handleDuplicateFolderNames(
	vault: Vault,
	folderName: string,
	settings: HubSettings
): Promise<void> {
	await assignNumberedHubsForName(vault, folderName, settings);
}

/**
 * Delete all hub files that use the given suffix (base or numbered) in non-skipped, non-root folders.
 */
async function deleteAllHubFilesWithSuffix(
	app: App,
	settings: HubSettings,
	suffix: string
): Promise<void> {
	const vault = app.vault;
	const options = pathSkipFromSettings(settings);
	const all = vault.getAllFolders(false);
	for (const folder of all) {
		if (shouldSkipPath(folder.path, options)) continue;
		if (isRootFolder(folder.path)) continue;
		const baseName = getHubNameForFolder(folder.name, suffix);
		const numberedPattern = getNumberedHubPattern(folder.name, suffix);
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (child.basename === baseName || numberedPattern.test(child.basename)) {
					setWriteLock(child.path);
					await app.fileManager.trashFile(child);
				}
			}
		}
	}
}

/** Used before creating hubs with new suffix. */
async function migrateHubSuffix(
	app: App,
	settings: HubSettings,
	oldSuffix: string
): Promise<void> {
	await deleteAllHubFilesWithSuffix(app, settings, oldSuffix);
}

/**
 * Remove all hub notes from the vault (match current suffix and numbered pattern). Does not touch links in notes.
 * Uses trash so the user's file deletion preference is respected.
 */
export async function removeAllHubNotes(app: App, settings: HubSettings): Promise<void> {
	await deleteAllHubFilesWithSuffix(app, settings, settings.hubSuffix || "_");
}

/**
 * Build/Refresh foldersuffix(#) notes: if suffix changed, migrate (delete old hubs); then iterate non-skipped, non-root folders, ensureHubForFolder each; then numbering pass. No link-in-notes logic.
 */
export async function buildRefreshHubNotes(app: App, settings: HubSettings): Promise<void> {
	const vault = app.vault;
	const prev = settings.previousHubSuffix ?? settings.hubSuffix;
	if (prev !== settings.hubSuffix) {
		await migrateHubSuffix(app, settings, prev);
		// Do not set previousHubSuffix here: link stripping needs it to remove old-suffix links until user runs Build/Refresh links (or changes suffix again in UI).
	}
	const options = pathSkipFromSettings(settings);
	const all = vault.getAllFolders(false);
	for (const folder of all) {
		if (shouldSkipPath(folder.path, options)) continue;
		if (isRootFolder(folder.path)) continue;
		await ensureHubForFolder(vault, folder, settings);
	}
	const nameCount = new Map<string, number>();
	for (const folder of all) {
		if (shouldSkipPath(folder.path, options)) continue;
		if (isRootFolder(folder.path)) continue;
		nameCount.set(folder.name, (nameCount.get(folder.name) ?? 0) + 1);
	}
	for (const [name, count] of nameCount) {
		if (count > 1) await assignNumberedHubsForName(vault, name, settings);
	}
}
