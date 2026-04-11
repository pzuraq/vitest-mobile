/**
 * Screenshot API — request a screenshot of the running emulator/simulator.
 *
 * In connected mode: sends request to pool worker over WebSocket, host captures via adb/simctl.
 * In explorer mode: no-op (user can see the screen directly).
 */

import { requestScreenshot, isConnected } from './setup';

/**
 * Take a screenshot of the running emulator/simulator.
 * Returns the absolute file path on the host machine.
 *
 * When not connected to the pool, returns a placeholder since there's
 * no host to relay the screenshot request to.
 */
export async function screenshot(name?: string): Promise<string> {
  if (!isConnected()) {
    console.log(`[screenshot] ${name ?? 'screenshot'} (skipped — not connected)`);
    return `(not connected) ${name ?? 'screenshot'}`;
  }
  return requestScreenshot(name);
}
