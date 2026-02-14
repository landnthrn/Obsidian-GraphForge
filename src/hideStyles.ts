/**
 * CSS injection and file explorer decoration for hide options.
 */

import type { App } from "obsidian";
import { Vault } from "obsidian";
import {
	CSS_CLASS_HUB_IN_EXPLORER,
	CSS_CLASS_OB_HIDE,
	HIDE_STYLE_EL_ID,
} from "./constants";
import { getExpectedHubNameForFolder } from "./hubForFolder";
import { isRootFolder, shouldSkipPath, type PathSkipOptions } from "./pathRules";
import type { HubSettings } from "./settings";

function pathSkipFromSettings(s: HubSettings): PathSkipOptions {
	return { skipFolderNames: s.skipFolderNames, skipDotFolders: s.skipDotFolders };
}

/**
 * Set of vault-absolute paths to hub note files (for explorer hiding).
 */
export async function getHubNotePaths(
	vault: Vault,
	settings: HubSettings
): Promise<Set<string>> {
	const options = pathSkipFromSettings(settings);
	const all = vault.getAllFolders(false);
	const paths = new Set<string>();
	for (const folder of all) {
		if (shouldSkipPath(folder.path, options)) continue;
		if (isRootFolder(folder.path)) continue;
		const name = await getExpectedHubNameForFolder(vault, folder, settings);
		paths.add(folder.path + "/" + name + ".md");
	}
	return paths;
}

/**
 * Inject or update the style element for hide rules. Call on load and when hide settings change.
 */
export function injectHideCSS(settings: HubSettings): void {
	let el = document.getElementById(HIDE_STYLE_EL_ID) as HTMLStyleElement | null;
	if (!el) {
		el = document.createElement("style");
		el.id = HIDE_STYLE_EL_ID;
		document.head.appendChild(el);
	}
	const parts: string[] = [];
	parts.push(`.${CSS_CLASS_OB_HIDE}{display:none !important}`);
	if (settings.hideHubNotesInExplorer) {
		parts.push(`.${CSS_CLASS_HUB_IN_EXPLORER}{display:none !important}`);
	}
	const color = (settings.folderDirectoryColor || "#7B61E2").replace(/"/g, '\\"');
	parts.push(
		".folder-directory-container{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:16px 0}",
		`.folder-directory-card{background-color:${color};border-radius:8px;padding:12px;cursor:pointer;transition:transform .2s,box-shadow .2s;box-shadow:0 2px 4px rgba(0,0,0,.1)}`,
		".folder-directory-card:hover{transform:translateY(-2px);box-shadow:0 4px 8px rgba(0,0,0,.15)}",
		".folder-directory-card-title{font-family:system-ui,-apple-system,sans-serif;font-weight:600;font-size:14px;color:white;margin:0 0 4px 0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}",
		".folder-directory-card-date{font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:rgba(255,255,255,.8);margin:4px 0 0 0}",
		".folder-directory-card-link{text-decoration:none;color:inherit;display:block}",
		".folder-directory-card-link:hover{text-decoration:none}",
		".folder-directory-card-header{display:flex;align-items:center;gap:8px;margin-bottom:4px}",
		".folder-directory-card-header .folder-directory-card-title{flex:1;min-width:0;margin:0}",
		".folder-directory-card-icon{--icon-size:18px;display:flex;align-items:center;color:rgba(255,255,255,.9)}",
		".folder-directory-card-subtitle{font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:rgba(255,255,255,.8);margin:4px 0 0 0}"
	);
	el.textContent = parts.join("\n");
}

/**
 * Add/remove hub-note class on file explorer items. Call after layout change or when hideHubNotesInExplorer changes.
 */
export async function decorateFileExplorer(
	app: App,
	settings: HubSettings
): Promise<void> {
	if (!settings.hideHubNotesInExplorer) {
		document.querySelectorAll(`.${CSS_CLASS_HUB_IN_EXPLORER}`).forEach((n) => {
			n.classList.remove(CSS_CLASS_HUB_IN_EXPLORER);
		});
		return;
	}
	const paths = await getHubNotePaths(app.vault, settings);
	const navFiles = document.querySelectorAll(".nav-file");
	navFiles.forEach((el) => {
		const path =
			(el as HTMLElement).getAttribute("data-path") ??
			(el as HTMLElement).querySelector("[data-path]")?.getAttribute("data-path") ??
			(el as HTMLElement).querySelector("a[data-href]")?.getAttribute("data-href") ??
			"";
		if (path && paths.has(path)) {
			el.classList.add(CSS_CLASS_HUB_IN_EXPLORER);
		} else {
			el.classList.remove(CSS_CLASS_HUB_IN_EXPLORER);
		}
	});
}
