/**
 * Path and folder rules — no I/O.
 * Single source of truth for: "should we skip this path?", "is this the root folder?",
 * "what is the hub name for this folder?", "what is the numbered hub name?", "regex for numbered hubs".
 */

export interface PathSkipOptions {
	skipFolderNames: string[];
	skipDotFolders: boolean;
}

/**
 * True if we should skip this path: root, or any segment is in excluded names or (when skipDotFolders) a dot-folder.
 */
export function shouldSkipPath(path: string, options: PathSkipOptions): boolean {
	const normalized = path.replace(/^\/|\/$/g, "") || "";
	if (normalized === "") return true;
	const segments = normalized.split("/").filter(Boolean);
	const { skipFolderNames, skipDotFolders } = options;
	for (const segment of segments) {
		if (skipFolderNames.includes(segment)) return true;
		if (skipDotFolders && segment.startsWith(".")) return true;
	}
	return false;
}

/**
 * True when the folder path is the vault root (empty or slash-only).
 */
export function isRootFolder(folderPath: string): boolean {
	const normalized = folderPath.replace(/^\/|\/$/g, "").trim();
	return normalized === "";
}

/**
 * Base hub name for a folder: folderName + suffix (e.g. "MyFolder" + "_" → "MyFolder_").
 */
export function getHubNameForFolder(folderName: string, suffix: string): string {
	return folderName + (suffix || "_");
}

/**
 * Numbered hub name for shared-name folders: folderName + suffix + index (e.g. "MyFolder_1", "MyFolder_2").
 */
export function getNumberedHubName(folderName: string, index: number, suffix: string): string {
	const s = suffix || "_";
	return folderName + s + String(index);
}

/** Escape special regex characters in a string for use in RegExp. */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * RegExp that matches numbered hub names for this folder (e.g. MyFolder_1, MyFolder_2).
 * Full string match; suffix is escaped.
 */
export function getNumberedHubPattern(folderName: string, suffix: string): RegExp {
	const escapedFolder = escapeRegex(folderName);
	const escapedSuffix = escapeRegex(suffix || "_");
	return new RegExp(`^${escapedFolder}${escapedSuffix}\\d+$`);
}
