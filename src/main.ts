import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import { STARTUP_DELAY_MS } from "./constants";
import { decorateFileExplorer, injectHideCSS } from "./hideStyles";
import { buildRefreshHubNotes, removeAllHubNotes } from "./hubContent";
import { buildRefreshHubLinks, removeAllHubLinksFromNotes } from "./linksInNotes";
import { registerFolderDirectoryProcessor } from "./folderDirectoryBlock";
import { DEFAULT_SETTINGS, GraphforgeSettingTab, HubSettings } from "./settings";
import { registerVaultEvents } from "./vaultEvents";

export default class GraphforgePlugin extends Plugin {
	settings: HubSettings;
	private fileExplorerMutationObserver: MutationObserver | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new GraphforgeSettingTab(this.app, this));
		registerCommands(this);
		registerVaultEvents(this);
		registerFolderDirectoryProcessor(this, this.settings);
		injectHideCSS(this.settings);
		// Decorate immediately and at intervals so hub notes are hidden before first paint and after any delayed DOM.
		decorateFileExplorer(this.app, this.settings).catch(() => {});
		const scheduleDecorate = () => decorateFileExplorer(this.app, this.settings).catch(() => {});
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				void scheduleDecorate();
			})
		);
		[0, 50, 150, 400, 600].forEach((ms) => {
			this.registerInterval(window.setTimeout(scheduleDecorate, ms));
		});
		// Re-decorate when file explorer DOM changes so new .nav-file nodes get the hide class before they flash.
		const attachObserver = () => {
			if (this.fileExplorerMutationObserver) return;
			const container = document.querySelector(".nav-files-container");
			if (!container) return;
			let rafId = 0;
			const observer = new MutationObserver(() => {
				if (!this.settings.hideHubNotesInExplorer) return;
				if (rafId) cancelAnimationFrame(rafId);
				rafId = requestAnimationFrame(() => {
					rafId = 0;
					scheduleDecorate();
				});
			});
			observer.observe(container, { childList: true, subtree: true });
			this.fileExplorerMutationObserver = observer;
		};
		attachObserver();
		this.registerInterval(window.setTimeout(attachObserver, 100));
		this.registerInterval(window.setTimeout(attachObserver, 500));
		if (this.settings.realTimeUpdating && !this.settings.autoCreateSuppressedUntilBuildRefresh) {
			this.registerInterval(
				window.setTimeout(() => this.runStartupRefresh(), STARTUP_DELAY_MS)
			);
		}
	}

	/** Re-inject hide CSS and re-decorate file explorer. Call when hide settings change. */
	refreshHideState(): void {
		injectHideCSS(this.settings);
		void decorateFileExplorer(this.app, this.settings).catch(() => {});
	}

	onunload() {
		this.fileExplorerMutationObserver?.disconnect();
		this.fileExplorerMutationObserver = null;
	}

	/** Same as Build/Refresh buttons: hub notes then hub links. Clears auto-create suppressed; saves settings. */
	async buildRefreshHubNotes(): Promise<void> {
		this.settings.autoCreateSuppressedUntilBuildRefresh = false;
		await this.saveSettings();
		await buildRefreshHubNotes(this.app, this.settings);
		await this.saveSettings();
		new Notice("Finished. Built/refreshed hub notes.");
	}

	async buildRefreshHubLinks(): Promise<void> {
		this.settings.autoCreateSuppressedUntilBuildRefresh = false;
		await this.saveSettings();
		await buildRefreshHubLinks(this.app.vault, this.settings);
		await this.saveSettings(); // persist previousHubSuffix sync after link refresh
		new Notice("Finished. Built/refreshed hub links in notes.");
	}

	/** Remove all hub notes; set flag so startup/real-time do not recreate until Build/Refresh. */
	async removeAllHubNotes(): Promise<void> {
		this.settings.autoCreateSuppressedUntilBuildRefresh = true;
		await this.saveSettings();
		await removeAllHubNotes(this.app, this.settings);
		new Notice("Finished. Removed the hub notes from vault.");
		new Notice("Real time updating is paused until you build/refresh.");
	}

	/** Remove all hub links from notes; set flag so startup/real-time do not recreate until Build/Refresh. */
	async removeAllHubLinks(): Promise<void> {
		this.settings.autoCreateSuppressedUntilBuildRefresh = true;
		await this.saveSettings();
		await removeAllHubLinksFromNotes(this.app.vault, this.settings);
		new Notice("Finished. Removed the hub links in notes.");
		new Notice("Real time updating is paused until you build/refresh.");
	}

	/** Startup: run same flow as Build/Refresh with real-time temporarily off. Skipped when autoCreateSuppressedUntilBuildRefresh. */
	private async runStartupRefresh(): Promise<void> {
		const wasRealTime = this.settings.realTimeUpdating;
		this.settings.realTimeUpdating = false;
		try {
			await buildRefreshHubNotes(this.app, this.settings);
			await this.saveSettings();
			await buildRefreshHubLinks(this.app.vault, this.settings);
		} finally {
			this.settings.realTimeUpdating = wasRealTime;
			await this.saveSettings();
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<HubSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...data };
		if (Array.isArray(data?.skipFolderNames)) {
			this.settings.skipFolderNames = [...data.skipFolderNames];
		} else {
			this.settings.skipFolderNames = [this.app.vault.configDir, ".trash", "ATTACHMENTS"];
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
