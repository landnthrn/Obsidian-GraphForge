/**
 * Single source of truth for timing and retry constants.
 * No magic numbers in feature code — import from here only.
 */

/** Number of attempts when waiting for a hub to be numbered (e.g. after rename). */
export const WAIT_FOR_HUB_ATTEMPTS = 60;

/** Milliseconds to wait between each attempt. */
export const WAIT_MS_PER_ATTEMPT = 100;

/** Write lock TTL: ignore our own vault events for this long after writing a path (ms). */
export const WRITE_LOCK_MS = 1200;

/** Delay before running startup Build/Refresh (ms). */
export const STARTUP_DELAY_MS = 2000;

/** CSS class for hidden content (hub links when auto-hide on). */
export const CSS_CLASS_OB_HIDE = "graphforge-ob-hide";

/** CSS class added to file explorer items that are hub notes (when hide in explorer on). */
export const CSS_CLASS_HUB_IN_EXPLORER = "graphforge-hub-note-explorer";

/** Id of the injected style element for hide rules. */
export const HIDE_STYLE_EL_ID = "graphforge-hide-styles";
