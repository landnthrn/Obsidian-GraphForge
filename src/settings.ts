import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";

/** Obsidian-style confirmation modal for restore settings. */
class RestoreConfirmModal extends Modal {
	constructor(
		app: App,
		readonly onConfirm: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Restore to default?");
		this.contentEl.createEl("p", {
			text: "Are you sure you want to restore all options to their default values? This cannot be undone.",
			cls: "setting-item-description",
		});
		const btnWrap = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = btnWrap.createEl("button", { text: "Cancel" });
		const restore = btnWrap.createEl("button", { text: "Restore", cls: "mod-warning" });
		cancel.addEventListener("click", () => this.close());
		restore.addEventListener("click", () => {
			void Promise.resolve(this.onConfirm()).then(() => this.close());
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface HubSettings {
	hubSuffix: string;
	/** Stored when user saves a new suffix; used for migration on Build/Refresh. */
	previousHubSuffix: string;
	hubInsertTitle: string;
	skipFolderNames: string[];
	skipDotFolders: boolean;
	parentLinkForSubfolderHubs: boolean;
	updateHubOnFolderRename: boolean;
	insertHubLinkOnCreate: boolean;
	updateHubLinkOnMove: boolean;
	debugLogs: boolean;
	hideObHideSpans: boolean;
	removeHiddenBlink: boolean;
	autoHideHubLinks: boolean;
	hideHubNotesInExplorer: boolean;
	folderDirectoryColor: string;
	realTimeUpdating: boolean;
	excludeHubLinksFromSelectAll: boolean;
	insertSeparatorAfterHubLink: boolean;
	/** When true, do not auto-create hubs/links (startup and real-time) until user runs Build/Refresh. Set by Remove buttons; cleared by Build/Refresh. */
	autoCreateSuppressedUntilBuildRefresh: boolean;
}

export const DEFAULT_SETTINGS: HubSettings = {
	hubSuffix: "_",
	previousHubSuffix: "_",
	hubInsertTitle: "## DIRECTORY",
	skipFolderNames: [".trash", "ATTACHMENTS"],
	skipDotFolders: true,
	parentLinkForSubfolderHubs: true,
	updateHubOnFolderRename: true,
	insertHubLinkOnCreate: true,
	updateHubLinkOnMove: true,
	debugLogs: false,
	hideObHideSpans: true,
	removeHiddenBlink: false,
	autoHideHubLinks: false,
	hideHubNotesInExplorer: true,
	folderDirectoryColor: "#7B61E2",
	realTimeUpdating: true,
	excludeHubLinksFromSelectAll: true,
	insertSeparatorAfterHubLink: true,
	// true = no hub/link creation on startup or real-time until user runs Build/Refresh (first-time, after Remove, or after suffix change).
	autoCreateSuppressedUntilBuildRefresh: true,
};

export class GraphforgeSettingTab extends PluginSettingTab {
	plugin: Plugin & {
		settings: HubSettings;
		saveSettings: () => Promise<void>;
		buildRefreshHubNotes: () => Promise<void>;
		buildRefreshHubLinks: () => Promise<void>;
		removeAllHubNotes: () => Promise<void>;
		removeAllHubLinks: () => Promise<void>;
		refreshHideState: () => void;
	};

	constructor(
		app: App,
		plugin: Plugin & {
			settings: HubSettings;
			saveSettings: () => Promise<void>;
			buildRefreshHubNotes: () => Promise<void>;
			buildRefreshHubLinks: () => Promise<void>;
			removeAllHubNotes: () => Promise<void>;
			removeAllHubLinks: () => Promise<void>;
			refreshHideState: () => void;
		}
	) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const banner = containerEl.createEl("img", { cls: "graphforge-banner" });
		banner.setAttribute("src", "https://raw.githubusercontent.com/landnthrnnn/DUMP/refs/heads/main/GraphForge%20Title%20-%20Galaxy%201.2.png");
		banner.setAttribute("alt", "Graphforge");

		containerEl.createEl("div", { cls: "graphforge-tab-title", text: "Graphforge" });
		new Setting(containerEl).setName("By landn.thrn").setHeading();
		containerEl.createEl("p", {
			text: "Automatically creates and maintains a graph view of your notes, if they're organized into folders. Folders act as the root node in graph view. Provides a quick access hub note display for each folder.",
			cls: "plugin-description",
		});
		const howItWorksP = containerEl.createEl("p", { cls: "plugin-description" });
		howItWorksP.appendChild(containerEl.createEl("strong", { text: "How it works" }));
		containerEl.createEl("p", {
			text: "Creates a foldersuffix(#) note for each folder (hidden by default). These act as folder nodes in graph view that all notes inside their folders attach to. Links to each hub note get added at the top of all notes. Options to customize the workflow to your liking.",
			cls: "plugin-description",
		});
		containerEl.createDiv({ cls: "graphforge-desc-spacer" });

		new Setting(containerEl).setName("Graph creation").setHeading();

		new Setting(containerEl)
			.setName("Build/refresh foldernamesuffix(#) notes")
			.setDesc("Creates hub notes for each folder (hidden by default). These act as folder nodes in graph view. Shared named folders are supported by a # sequence in filename, in order of note creation time.")
			.addButton((btn) =>
				btn
					.setButtonText("Build/refresh hub notes")
					.setCta()
					.onClick(() => this.plugin.buildRefreshHubNotes())
			);

		new Setting(containerEl)
			.setName("Build/refresh foldernamesuffix(#) links in notes")
			.setDesc("Adds hub links at the top of all notes that are inside folders, linking all notes to their appropriate hub note. You can hide the links from your notes with the options below.")
			.addButton((btn) =>
				btn
					.setButtonText("Build/refresh hub links in notes")
					.setCta()
					.onClick(() => this.plugin.buildRefreshHubLinks())
			);

		new Setting(containerEl)
			.setName("Remove foldernamesuffix(#) notes")
			.setDesc("Remove all hub notes (foldersuffix(#) notes). This will only take effect on notes that match their folder name, plus suffix (and number for shared-name folders).")
			.addButton((btn) =>
				btn
					.setButtonText("Remove hub notes")
					.setWarning()
					.onClick(() => this.plugin.removeAllHubNotes())
			);

		new Setting(containerEl)
			.setName("Remove foldernamesuffix(#) links from notes")
			.setDesc("Remove all hub links (foldersuffix(#) links inside notes). This will only take effect on links in your notes that match the hub note name, plus suffix (and number for shared-name folders).")
			.addButton((btn) =>
				btn
					.setButtonText("Remove hub links from notes")
					.setWarning()
					.onClick(() => this.plugin.removeAllHubLinks())
			);

		new Setting(containerEl)
			.setName("Real-time updating")
			.setDesc("Keep all hub notes and hub links in notes up to date through location changes, renames, and such. If disabled, updates will only occur when manually using the build/refresh buttons above.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.realTimeUpdating).onChange(async (v) => {
					this.plugin.settings.realTimeUpdating = v;
					await this.plugin.saveSettings();
				})
			);

		// Custom suffix: save on Enter or blur only
		const suffixSetting = new Setting(containerEl)
			.setName("Custom suffix for foldersuffix(#) notes and links")
			.setDesc("Custom suffix for hub note names and hub links ( _ , -- , ( , ; ). Use the build/refresh buttons to see changes.");
		const suffixInput = suffixSetting.controlEl.createEl("input", {
			type: "text",
			value: this.plugin.settings.hubSuffix,
			placeholder: "_",
			cls: "mod-text-input",
		});
		let pendingSuffix = this.plugin.settings.hubSuffix;
		suffixInput.addEventListener("input", () => {
			const v = suffixInput.value;
			const hasInvalidChars = /[<>:"/\\|?*]/.test(v) || [...v].some((c) => {
				const code = c.charCodeAt(0);
				return code >= 0 && code <= 31;
			});
			if (hasInvalidChars) {
				suffixInput.value = this.plugin.settings.hubSuffix;
				pendingSuffix = this.plugin.settings.hubSuffix;
				return;
			}
			pendingSuffix = v || "_";
		});
		const saveSuffix = async () => {
			if (pendingSuffix === this.plugin.settings.hubSuffix) return;
			this.plugin.settings.previousHubSuffix = this.plugin.settings.hubSuffix;
			this.plugin.settings.hubSuffix = pendingSuffix;
			await this.plugin.saveSettings();
		};
		suffixInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void saveSuffix();
			}
		});
		suffixInput.addEventListener("blur", () => {
			void saveSuffix();
		});

		new Setting(containerEl).setName("Hide and unhide").setHeading();

		new Setting(containerEl)
			.setName("Hide foldersuffix(#) notes in file explorer")
			.setDesc("When enabled, hub notes will be hidden in the file explorer sidebar, but still appear in graph view, and if you select their links in notes.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.hideHubNotesInExplorer).onChange(async (v) => {
					this.plugin.settings.hideHubNotesInExplorer = v;
					await this.plugin.saveSettings();
					this.plugin.refreshHideState();
				})
			);

		new Setting(containerEl)
			.setName("Hide links at the top of notes")
			.setDesc("When enabled, the hub links inside notes will be hidden.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoHideHubLinks).onChange(async (v) => {
					this.plugin.settings.autoHideHubLinks = v;
					if (v) {
						this.plugin.settings.removeHiddenBlink = true; // enable in sync when hide links turns on (recommended)
					} else {
						this.plugin.settings.removeHiddenBlink = false;
					}
					await this.plugin.saveSettings();
					this.plugin.refreshHideState();
					// Save scroll position before re-render so we can restore it (display() rebuilds the tab and would scroll to top).
					const scrollEl = containerEl.closest(".vertical-tab-content") ?? containerEl.parentElement;
					const scrollTop = scrollEl?.scrollTop ?? 0;
					this.display();
					setTimeout(() => {
						if (scrollEl) scrollEl.scrollTop = scrollTop;
					}, 0);
					void this.plugin.buildRefreshHubLinks();
				})
			);

		new Setting(containerEl)
			.setName("Fix hidden text blink on opening a note")
			.setDesc("When text is hidden on the first lines of notes, it blinks on opening. This fixes that (requires two of the top lines). Use the build/refresh buttons to see changes.")
			.addToggle((t) => {
			t.setValue(this.plugin.settings.removeHiddenBlink);
			t.setDisabled(!this.plugin.settings.autoHideHubLinks);
			t.onChange(async (v) => {
				if (!this.plugin.settings.autoHideHubLinks) {
					t.setValue(false);
					return;
				}
				this.plugin.settings.removeHiddenBlink = v;
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl).setName("Miscellaneous").setHeading();

		new Setting(containerEl)
			.setName("Exclude folders (exact names)")
			.setDesc("Enter folder names to ignore anywhere (comma-separated if multiple). Use the removal buttons, then build/refresh to see changes.")
			.addText((txt) =>
				txt
					.setValue(this.plugin.settings.skipFolderNames.join(", "))
					.onChange(async (v) => {
						this.plugin.settings.skipFolderNames = v.split(",").map((s) => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Exclude dot-folders")
			.setDesc("Ignore any folder whose name starts with a dot. (comma-separated if multiple). Use the removal buttons, then build/refresh to see changes.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.skipDotFolders).onChange(async (v) => {
					this.plugin.settings.skipDotFolders = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Configure Ctrl + A to not select hub links in notes")
			.setDesc("When using Ctrl + A to select all in notes, exclude selecting hub links foldersuffix(#) links inside notes. This prevents you from accidentally interacting with them.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.excludeHubLinksFromSelectAll).onChange(async (v) => {
					this.plugin.settings.excludeHubLinksFromSelectAll = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Add a separator line after hub link in notes")
			.setDesc("When enabled, a `---` line will be inserted below hub links in notes. Use the build/refresh buttons to see changes.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.insertSeparatorAfterHubLink).onChange(async (v) => {
					this.plugin.settings.insertSeparatorAfterHubLink = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Folder directory card color")
			.setDesc("Custom hex color code for folder directory cards displayed in hub notes.")
			.addText((txt) =>
				txt
					.setValue(this.plugin.settings.folderDirectoryColor)
					.setPlaceholder("#7B61E2")
					.onChange(async (v) => {
						const valid = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v) || v === "";
						if (valid) {
							this.plugin.settings.folderDirectoryColor = v || "#7B61E2";
							await this.plugin.saveSettings();
							this.plugin.refreshHideState();
						} else {
							new Notice("Invalid hex color format. Use a format like #7B61E2.");
						}
					})
			);

		new Setting(containerEl)
			.setName("Restore to default")
			.setDesc("Reset all options to their default values.")
			.addButton((btn) =>
				btn.setButtonText("Restore to default").setWarning().onClick(() => {
					new RestoreConfirmModal(this.app, async () => {
						this.plugin.settings = { ...DEFAULT_SETTINGS, skipFolderNames: [...DEFAULT_SETTINGS.skipFolderNames] };
						this.plugin.settings.skipFolderNames = [this.app.vault.configDir, ".trash", "ATTACHMENTS"];
						await this.plugin.saveSettings();
						this.plugin.refreshHideState();
						this.display();
						new Notice("Restored to defaults.");
					}).open();
				})
			);

		new Setting(containerEl).setName("Debugging").setHeading();

		new Setting(containerEl)
			.setName("Debug logs")
			.setDesc("Print debug logs to the developer console.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.debugLogs).onChange(async (v) => {
					this.plugin.settings.debugLogs = v;
					await this.plugin.saveSettings();
				})
			);

		const foundUsefulWrap = containerEl.createDiv({ cls: "graphforge-found-useful-wrap" });
		const headingRow = foundUsefulWrap.createEl("div", { cls: "graphforge-found-useful-title-row" });
		headingRow.createEl("span", { cls: "graphforge-found-useful-heading", text: "Found this useful?" });
		headingRow.createEl("img", {
			cls: "graphforge-found-useful-gif",
			attr: {
				src: "https://media.tenor.com/23NitOvEEkMAAAAj/optical-illusion-rotating-head.gif",
				alt: "",
				width: "30",
			},
		});
		const badgeContainer = foundUsefulWrap.createDiv({ cls: "graphforge-found-useful-badges" });
		const badges: { img: string; href: string }[] = [
			{
				img: "https://img.shields.io/badge/Follow%20My%20GitHub%20%3C3-000000?style=for-the-badge&logo=github&logoColor=white",
				href: "https://github.com/landnthrn",
			},
			{
				img: "https://img.shields.io/badge/Find%20More%20of%20my%20Creations%20on%20GitHub-311A82?style=for-the-badge&logo=github&logoColor=white",
				href: "https://github.com/landnthrn?tab=repositories",
			},
			{
				img: "https://img.shields.io/badge/Gists-311A82?style=for-the-badge&logo=github&logoColor=white",
				href: "https://gist.github.com/landnthrn",
			},
			{
				img: "https://img.shields.io/badge/Discord-311A82?style=for-the-badge&logo=discord&logoColor=white",
				href: "https://discord.com/users/831735011588964392",
			},
			{
				img: "https://img.shields.io/badge/Buy%20Me%20a%20Coffee-311A82?style=for-the-badge&logo=buymeacoffee&logoColor=white",
				href: "https://buymeacoffee.com/landn.thrn/extras",
			},
			{
				img: "https://img.shields.io/badge/PayPal-311A82?style=for-the-badge&logo=paypal&logoColor=white",
				href: "https://www.paypal.com/donate/?hosted_button_id=K4PLHFVBH7X8C",
			},
		];
		for (const b of badges) {
			const a = badgeContainer.createEl("a", { href: b.href, cls: "graphforge-badge-link" });
			a.setAttribute("target", "_blank");
			a.setAttribute("rel", "noopener");
			a.createEl("img", { attr: { src: b.img, alt: "" } });
		}
	}
}
