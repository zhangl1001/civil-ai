import { Capacitor } from '@capacitor/core';

const RECOVERY_EVENT = 'zhangl-database-stalled';
const LAST_RECOVERY_KEY = 'zhangl.database.last-stall-recovery';
const RECOVERY_COOLDOWN_MS = 30_000;
const RELOAD_DELAY_MS = 2_200;

let installed = false;
let lastRecoveryAt = 0;

/**
 * A stalled native bridge must not leave the in-memory database mutex blocking every view.
 * Reloading recreates the runtime; SQLite initialization rolls back any abandoned transaction.
 */
export function installDatabaseStallRecovery(): void {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;
  window.addEventListener(RECOVERY_EVENT, (event) => {
    const now = Date.now();
    let previous = lastRecoveryAt;
    try {
      previous = Math.max(previous, Number(sessionStorage.getItem(LAST_RECOVERY_KEY) || 0));
    } catch {
      // In-memory cooldown still prevents an immediate reload loop.
    }
    console.error('[DatabaseStallRecovery]', (event as CustomEvent<unknown>).detail);
    if (now - previous < RECOVERY_COOLDOWN_MS) return;
    lastRecoveryAt = now;
    try {
      sessionStorage.setItem(LAST_RECOVERY_KEY, String(now));
    } catch {
      // Recovery must not depend on Web Storage availability.
    }
    window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
  });
}
