# Custom Pool Workers need a `close()` lifecycle hook

## Problem

As a developer building a custom Vitest pool, I want a way to distinguish "done with this test file" from "done with the entire test run" so that I can properly manage long-lived resources like WebSocket connections, emulators, and servers.

Currently, the custom pool worker interface only exposes `start()` and `stop()`. Vitest calls `stop()` after **each test file** (per-file worker lifecycle in `Pool.schedule`), and also during `Pool.cancel()` when the entire run ends. For the built-in forks/threads pools this works fine — each worker is a disposable OS process that gets killed on `stop()`. But for custom pools that maintain persistent connections to external runtimes (mobile emulators, browser engines, embedded devices), there's no way to know when it's safe to tear down shared infrastructure.

### Concrete example: vitest-mobile

[vitest-mobile](https://github.com/pzuraq/vitest-mobile) is a custom pool that runs tests on iOS/Android simulators. A single WebSocket connection bridges the Vitest process to a React Native app running on the device. The lifecycle looks like:

```
vitest start
  └─ worker.start()     → boot emulator, launch app, connect WebSocket (~60-90s)
  └─ file 1: start → run → stop   ← vitest calls stop() here
  └─ file 2: start → run → stop   ← and here
  └─ file 3: start → run → stop   ← and here
  └─ Pool.close()                  ← we need to tear down here, not above
```

If we clean up the WebSocket in `stop()`, files 2 and 3 fail with "app not connected." If we don't clean up at all, the process hangs because the WebSocket server keeps the event loop alive. We currently work around this with a reporter's `onTestRunEnd` hook, but that's indirect — it's not part of the pool worker contract.

### The gap in the current API

```typescript
// Current custom pool worker interface
interface PoolWorker {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>; // ← called per-file AND during close
  send(message): void;
  on(event, callback): void;
  off(event, callback): void;
  deserialize(data): unknown;
}
```

The built-in pools don't need `close()` because:

- **forks/threads**: `stop()` kills the child process — it's always safe
- **browser**: the browser pool object has its own `close()` on the pool wrapper, separate from individual workers

Custom pools don't have access to the pool wrapper's `close()`. They only get the worker-level `stop()`.

## Suggested solution

Add an optional `close()` method to the pool worker interface:

```typescript
interface PoolWorker {
  // ... existing methods ...
  stop(): Promise<void>; // per-file teardown (called after each file)
  close?(): Promise<void>; // final teardown (called once when pool shuts down)
}
```

In `Pool.cancel()` / `Pool.close()`, after stopping all runners, call `worker.close()` if it exists:

```typescript
// In Pool.cancel():
async cancel() {
  // ... existing cancel logic (stop runners, await exitPromises) ...

  // NEW: call close() on custom pool workers that define it
  for (const worker of this.customWorkers) {
    await worker.close?.();
  }
}
```

This would let custom pools distinguish the two lifecycle phases:

- `stop()` — "this file is done, reset per-file state but keep connections alive"
- `close()` — "the entire run is done, tear down everything"

### Related issue: per-file `start()` breaks session-level config

There's a second, related problem with the per-file lifecycle. Vitest creates a fresh `PoolRunner` for each test file and calls `worker.start()` + sends a `{ type: 'start' }` message for each one. The `start` message carries `config` (including `config.root`), which the worker runtime needs for correct file-hash ID generation (`generateFileHash(relative(root, filepath), projectName)`).

For custom pools with a persistent runtime (like a mobile device), this creates a dilemma:

- **Forward every `start` to the device**: The device-side handler runs `invalidateAllTestModules()` on each file, which can crash the app or destabilize the JS runtime mid-session.
- **Skip forwarding**: The device never receives `config.root`, so File task IDs generated on the device don't match the `TestSpecification.taskId` computed by vitest. Result: `spec.testModule` returns `undefined` for all files, the reporter sees empty modules, and prints "No test files found" despite all tests passing.
- **Forward only the first**: Works, but requires the custom pool to track this itself — the protocol doesn't distinguish "session start" from "per-file start."

A `close()` method would pair naturally with a **session-level `start()`** — called once when the pool initializes, separate from the per-file start/stop cycle. This would give custom pools a clear place to receive config and do one-time setup without per-file side effects.

## Alternative

Keep the current API and document the `onTestRunEnd` reporter workaround for teardown. For the config issue, custom pools can track whether they've forwarded the first `start` message. This works but couples pool teardown to the reporter system and requires manual deduplication — both feel like the wrong abstraction layer.

## Additional context

- The custom pool API is currently marked `@experimental`
- Both additions (`close()` and session-level `start()`) would be non-breaking (optional methods)
- The browser pool already has this separation internally — `close()` on the pool wrapper does final cleanup while individual test sessions have their own lifecycle
- The `start` message config is critical because `run` messages don't carry `config` — only `files`, `invalidates`, `providedContext`, `workerId`, and `environment`
