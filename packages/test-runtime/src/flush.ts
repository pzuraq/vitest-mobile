/**
 * Flush — wait for React state updates to commit in the real RN runtime.
 *
 * Since we're running inside a real app (not a test environment), we can't
 * use React's act(). Instead we yield to the event loop to let React
 * process state updates and commit them to the fiber tree.
 */

export function waitForNextFrame(): Promise<void> {
  // Two frames: one for React to process the state update,
  // one for the commit to the fiber tree.
  return new Promise((resolve) => setTimeout(resolve, 50));
}
