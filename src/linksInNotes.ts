/**
 * Links in notes: one place for "correct hub link for this note"; upsert or remove at top of note.
 */

import { TFile, TFolder, Vault } from "obsidian";
import { CSS_CLASS_OB_HIDE } from "./constants";
import { getExpectedHubNameForFolder, waitForNumberedHub } from "./hubForFolder";
import {
	getHubNameForFolder,
	getNumberedHubPattern,
	shouldSkipPath,
	type PathSkipOptions,
} from "./pathRules";
import type { HubSettings } from "./settings";
import { setWriteLock } from "./writeLock";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract wiki link target from a line ([[target]] or <span>[[target]]</span>). Returns null if not a hub-style link. */
function extractWikiLinkTarget(line: string): string | null {
	const trimmed = line.trim();
	const m1 = trimmed.match(/^\[\[([^\]#|]+)/);
	if (m1?.[1] != null) return m1[1];
	const m2 = trimmed.match(/<span[^>]*>\[\[([^\]#|]+)/);
	return m2?.[1] ?? null;
}

/** True if a link target looks like a hub name for the given suffix (name ends with suffix + optional digits). */
function targetMatchesHubSuffixPattern(target: string, suffix: string): boolean {
	const s = suffix || "_";
	return new RegExp(`^.*${escapeRegex(s)}\\d*$`).test(target);
}

/** True if this line is a wiki link to a hub (for this folder, or any hub when folder is null / root). When folder is null, matches current or previous suffix so we strip old links after a suffix change. */
function isHubLinkLine(line: string, folder: TFolder | null, settings: HubSettings): boolean {
	const target = extractWikiLinkTarget(line);
	if (target == null) return false;
	const suffix = settings.hubSuffix || "_";
	if (folder == null) {
		if (targetMatchesHubSuffixPattern(target, suffix)) return true;
		const prev = settings.previousHubSuffix ?? suffix;
		if (prev !== suffix && targetMatchesHubSuffixPattern(target, prev)) return true;
		return false;
	}
	const baseName = getHubNameForFolder(folder.name, suffix);
	const numberedPattern = getNumberedHubPattern(folder.name, suffix);
	return target === baseName || numberedPattern.test(target);
}

/**
 * Correct hub link for this note's folder, or null (e.g. at root).
 */
export async function getCorrectHubLinkForNote(
	vault: Vault,
	note: TFile,
	settings: HubSettings
): Promise<string | null> {
	const folder = note.parent;
	if (folder == null || folder.isRoot()) return null;
	if (shouldSkipPath(folder.path, pathSkipFromSettings(settings))) return null;
	const hub = await waitForNumberedHub(vault, folder, settings);
	if (hub == null) return null;
	const name = await getExpectedHubNameForFolder(vault, folder, settings);
	return `[[${name}]]`;
}

/**
 * Number of leading lines that are hub link lines (or blank before them). For Ctrl+A exclude-from-selection.
 */
export function getLeadingHubLinkLineCount(
	lines: string[],
	folder: TFolder | null,
	settings: HubSettings
): number {
	return stripLeadingHubLinkLines(lines, folder, settings);
}

/**
 * Number of lines to exclude from Ctrl+A. Detects the hub block actually present at the top of the note so exclusion is correct for any combination of removeHiddenBlink and insertSeparatorAfterHubLink (and legacy content).
 * Structure: optional leading blank(s), exactly one hub link line, exactly one blank, optionally "---" and one blank.
 */
export function getSelectAllExcludeLineCount(
	lines: string[],
	_folder: TFolder | null,
	settings: HubSettings
): number {
	let i = 0;
	// At most one leading blank (removeHiddenBlink adds one before the link)
	if (i < lines.length && (lines[i] ?? "").trim() === "") i++;
	const hubLine = lines[i];
	if (i >= lines.length || hubLine === undefined || !isHubLinkLine(hubLine, null, settings)) return 0;
	i++; // skip the hub link line
	// Exactly one blank after the link
	if (i < lines.length && (lines[i] ?? "").trim() === "") i++;
	// Optional "---" and one blank after it
	if (i < lines.length && (lines[i] ?? "").trim() === "---") {
		i++;
		if (i < lines.length && (lines[i] ?? "").trim() === "") i++;
	}
	return i;
}

/**
 * Strip leading hub link lines from lines array. Mutates and returns the index after the last removed line.
 */
function stripLeadingHubLinkLines(
	lines: string[],
	folder: TFolder | null,
	settings: HubSettings
): number {
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;
		const trimmed = line.trim();
		if (trimmed === "") {
			i++;
			continue;
		}
		if (isHubLinkLine(line, folder, settings)) {
			i++;
			continue;
		}
		break;
	}
	return i;
}

/**
 * Ensure note has exactly one hub link at top (or none if at root). Add/update/remove as needed. Uses write lock.
 */
/** True if this note is the hub note for its parent folder (so we do not add separator after link). */
async function isHubNote(
	vault: Vault,
	note: TFile,
	settings: HubSettings
): Promise<boolean> {
	const folder = note.parent;
	if (!folder || folder.isRoot()) return false;
	const expectedName = await getExpectedHubNameForFolder(vault, folder, settings);
	return note.basename === expectedName;
}

/** Correct parent-folder hub link for a hub note, or null if root-level folder. */
async function getCorrectParentLinkForHubNote(
	vault: Vault,
	note: TFile,
	settings: HubSettings
): Promise<string | null> {
	const folder = note.parent;
	if (!folder || folder.isRoot()) return null;
	const parent = folder.parent;
	if (!parent || parent.isRoot()) return null;
	if (shouldSkipPath(parent.path, pathSkipFromSettings(settings))) return null;
	await waitForNumberedHub(vault, parent, settings);
	const name = await getExpectedHubNameForFolder(vault, parent, settings);
	return `[[${name}]]`;
}

/** Replace or insert the parent link under the ## DIRECTORY heading. Returns modified content. */
function updateParentLinkUnderDirectory(
	content: string,
	parentLink: string | null
): string {
	const lines = content.split("\n");
	const dirIdx = lines.findIndex((l) => /^##\s+/.test(l.trim()));
	if (dirIdx === -1) return content;
	let j = dirIdx + 1;
	while (j < lines.length && (lines[j]?.trim() ?? "") === "") j++;
	const lineAtJ = lines[j];
	const linkIdx = j < lines.length && lineAtJ !== undefined && extractWikiLinkTarget(lineAtJ) != null ? j : -1;
	if (linkIdx !== -1) {
		if (parentLink != null) {
			lines[linkIdx] = parentLink;
			return lines.join("\n");
		}
		// Remove the link line and one trailing blank
		lines.splice(linkIdx, 1);
		const lineAfterSplice = lines[linkIdx];
		if (linkIdx < lines.length && (lineAfterSplice?.trim() ?? "") === "") lines.splice(linkIdx, 1);
		return lines.join("\n");
	}
	if (parentLink != null) {
		// Insert parent link after the blank(s) following the heading
		const insertAt = j;
		lines.splice(insertAt, 0, parentLink, "");
		return lines.join("\n");
	}
	return content;
}

export async function upsertHubLinkInNote(
	vault: Vault,
	note: TFile,
	settings: HubSettings
): Promise<void> {
	const correctLink = await getCorrectHubLinkForNote(vault, note, settings);
	const folder = note.parent;
	const content = await vault.read(note);
	const lines = content.split("\n");
	// Strip any hub-style link at top (folder=null = any suffix+#) so we replace, not prepend.
	const afterHub = stripLeadingHubLinkLines(lines, null, settings);
	let rest = lines.slice(afterHub).join("\n");
	// When removing hub link (note at root), also remove the separator line if present so it never remains.
	if (correctLink == null) {
		rest = rest.replace(/^\s*\n?---\s*\n\s*/, "");
	}
	const hubNote = await isHubNote(vault, note, settings);
	if (hubNote) {
		// Hub notes: no link at top; parent link lives under ## DIRECTORY only.
		const parentLink = await getCorrectParentLinkForHubNote(vault, note, settings);
		rest = updateParentLinkUnderDirectory(rest, parentLink);
		const newContent = rest;
		if (newContent === content) return;
		setWriteLock(note.path);
		await vault.modify(note, newContent);
		return;
	}
	const addSeparator = settings.insertSeparatorAfterHubLink && !hubNote;
	if (correctLink != null && addSeparator) {
		rest = rest.replace(/^\s*\n?---\s*\n\s*/, "");
	}
	let linkLine = correctLink ?? "";
	if (correctLink != null && settings.autoHideHubLinks) {
		linkLine = `<span class="${CSS_CLASS_OB_HIDE}">${correctLink}</span>`;
	}
	const prefixBlank = correctLink != null && settings.removeHiddenBlink ? "\n" : "";
	const newTop =
		correctLink != null
			? prefixBlank + linkLine + "\n\n" + (addSeparator ? "---\n\n" : "")
			: "";
	const newContent = newTop + rest;
	if (newContent === content) return;
	setWriteLock(note.path);
	await vault.modify(note, newContent);
}

/**
 * Remove hub link from note if present (e.g. when note moved to root). Same outcome as upsertHubLinkInNote when correct link is null.
 */
export async function removeHubLinkFromNoteIfPresent(
	vault: Vault,
	note: TFile,
	settings: HubSettings
): Promise<void> {
	await upsertHubLinkInNote(vault, note, settings);
}

/**
 * Build/Refresh foldersuffix(#) links in notes: iterate notes in non-skipped folders (and root for removal); call upsertHubLinkInNote. Does not create or rename hub notes.
 * After running, syncs previousHubSuffix to current so we only strip old-suffix links until links have been refreshed.
 */
export async function buildRefreshHubLinks(vault: Vault, settings: HubSettings): Promise<void> {
	const options = pathSkipFromSettings(settings);
	const files = vault.getMarkdownFiles();
	for (const file of files) {
		const folder = file.parent;
		if (folder != null && !folder.isRoot() && shouldSkipPath(folder.path, options)) continue;
		await upsertHubLinkInNote(vault, file, settings);
	}
	settings.previousHubSuffix = settings.hubSuffix;
}

/**
 * Remove all hub links from all notes. Does not delete hub notes. Strips leading hub link lines and optional separator.
 */
export async function removeAllHubLinksFromNotes(
	vault: Vault,
	settings: HubSettings
): Promise<void> {
	const files = vault.getMarkdownFiles();
	for (const file of files) {
		const content = await vault.read(file);
		const lines = content.split("\n");
		const afterHub = stripLeadingHubLinkLines(lines, null, settings);
		let rest = lines.slice(afterHub).join("\n");
		rest = rest.replace(/^\s*\n?---\s*\n\s*/, "");
		const hubNote = await isHubNote(vault, file, settings);
		if (hubNote) rest = updateParentLinkUnderDirectory(rest, null);
		if (rest === content) continue;
		setWriteLock(file.path);
		await vault.modify(file, rest);
	}
}
