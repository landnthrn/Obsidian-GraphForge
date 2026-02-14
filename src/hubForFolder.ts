/**
 * Single place for "the hub for this folder" and "wait until hub is numbered".
 * All callers use these; no other wait/retry loops.
 */

import { TFile, TFolder, Vault } from "obsidian";
import { WAIT_FOR_HUB_ATTEMPTS, WAIT_MS_PER_ATTEMPT } from "./constants";
import type { HubSettings } from "./settings";
import {
	getHubNameForFolder,
	getNumberedHubName,
	getNumberedHubPattern,
	shouldSkipPath,
	type PathSkipOptions,
} from "./pathRules";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

/**
 * Find existing hub file in folder (base or numbered) for a given folder name. Use this when the folder was renamed and the hub may still have the old name.
 */
export function findHubInFolderWithName(
	folder: TFolder,
	folderName: string,
	settings: HubSettings
): TFile | null {
	const suffix = settings.hubSuffix || "_";
	const baseName = getHubNameForFolder(folderName, suffix);
	const numberedPattern = getNumberedHubPattern(folderName, suffix);
	for (const child of folder.children) {
		if (child instanceof TFile) {
			if (child.basename === baseName || numberedPattern.test(child.basename)) {
				return child;
			}
		}
	}
	return null;
}

/**
 * Find existing hub file in folder (base or numbered). Returns null if none.
 */
export function findHubInFolder(folder: TFolder, settings: HubSettings): TFile | null {
	return findHubInFolderWithName(folder, folder.name, settings);
}

/**
 * All non-skipped folders with this name, ordered by creation time (oldest first).
 */
export async function getFoldersWithSameName(
	vault: Vault,
	folderName: string,
	options: PathSkipOptions
): Promise<TFolder[]> {
	const all = vault.getAllFolders(false);
	const sameName = all.filter(
		(f) => f.name === folderName && !shouldSkipPath(f.path, options)
	);
	const withStat = await Promise.all(
		sameName.map(async (f) => {
			const stat = await vault.adapter.stat(f.path);
			return { folder: f, ctime: stat?.ctime ?? 0 };
		})
	);
	withStat.sort((a, b) => a.ctime - b.ctime);
	return withStat.map((x) => x.folder);
}

/**
 * The name the hub for this folder should have (base or numbered). Uses same numbering rules everywhere.
 */
export async function getExpectedHubNameForFolder(
	vault: Vault,
	folder: TFolder,
	settings: HubSettings
): Promise<string> {
	const suffix = settings.hubSuffix || "_";
	const sameName = await getFoldersWithSameName(
		vault,
		folder.name,
		pathSkipFromSettings(settings)
	);
	if (sameName.length <= 1) return getHubNameForFolder(folder.name, suffix);
	const index = sameName.findIndex((f) => f.path === folder.path);
	if (index === -1) return getHubNameForFolder(folder.name, suffix);
	return getNumberedHubName(folder.name, index + 1, suffix);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitForNumberedHubOptions {
	attempts?: number;
	msPerAttempt?: number;
}

/**
 * Retry until the folder's hub exists and (if shared-name) is numbered, or timeout. Uses shared constants.
 */
export async function waitForNumberedHub(
	vault: Vault,
	folder: TFolder,
	settings: HubSettings,
	options?: WaitForNumberedHubOptions
): Promise<TFile | null> {
	const attempts = options?.attempts ?? WAIT_FOR_HUB_ATTEMPTS;
	const msPerAttempt = options?.msPerAttempt ?? WAIT_MS_PER_ATTEMPT;
	for (let i = 0; i < attempts; i++) {
		const expectedName = await getExpectedHubNameForFolder(vault, folder, settings);
		const hub = findHubInFolder(folder, settings);
		if (hub && hub.basename === expectedName) return hub;
		await sleep(msPerAttempt);
	}
	return null;
}
