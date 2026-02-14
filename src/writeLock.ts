/**
 * Write lock: ignore our own vault writes in event handlers for a short TTL.
 */

import { WRITE_LOCK_MS } from "./constants";

const locks = new Map<string, number>();

/**
 * Mark a path as just written. Event handlers should treat it as locked for WRITE_LOCK_MS.
 */
export function setWriteLock(path: string): void {
	locks.set(path, Date.now());
}

/**
 * True if this path was written recently and event handlers should ignore it.
 */
export function isWriteLocked(path: string): boolean {
	const t = locks.get(path);
	if (t == null) return false;
	if (Date.now() - t >= WRITE_LOCK_MS) {
		locks.delete(path);
		return false;
	}
	return true;
}
