/**
 * Single debug log helper. Only logs when settings.debugLogs is on.
 */

import type { HubSettings } from "./settings";

export function log(
	settings: HubSettings,
	...args: unknown[]
): void {
	if (settings.debugLogs) {
		console.log("[GraphForge]", ...args);
	}
}
