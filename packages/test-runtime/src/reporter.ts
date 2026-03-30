/**
 * Reporter — WebSocket client that sends test results to the CLI.
 */

import type { RunnerCallbacks, RunResult } from './runner';

const WS_URL = 'ws://localhost:7878';

let ws: WebSocket | null = null;
let connectionReady: Promise<void> | null = null;

export function connectReporter(): Promise<void> {
  if (connectionReady) return connectionReady;

  connectionReady = new Promise<void>((resolve, reject) => {
    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[reporter] Connected to CLI');
        resolve();
      };

      ws.onerror = (err) => {
        console.warn('[reporter] WebSocket error — CLI reporter may not be running.', err);
        // Resolve anyway so tests still run even without CLI
        resolve();
      };

      ws.onclose = () => {
        console.log('[reporter] Disconnected from CLI');
      };
    } catch {
      // WebSocket not available or connection failed — continue without reporting
      console.warn('[reporter] Could not connect to CLI reporter.');
      resolve();
    }
  });

  return connectionReady;
}

function send(data: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function disconnectReporter(): void {
  if (ws) {
    ws.close();
    ws = null;
    connectionReady = null;
  }
}

export function createReporterCallbacks(): RunnerCallbacks {
  return {
    onSuiteStart(name, path) {
      send({ type: 'suite:start', name, path });
    },
    onSuiteEnd(name, path) {
      send({ type: 'suite:end', name, path });
    },
    onTestStart(name, path) {
      send({ type: 'test:start', name, path });
    },
    onTestPass(name, path, duration) {
      send({ type: 'test:pass', name, path, duration });
    },
    onTestFail(name, path, duration, error) {
      send({ type: 'test:fail', name, path, duration, error });
    },
    onTestSkip(name, path) {
      send({ type: 'test:skip', name, path });
    },
    onRunComplete(result: RunResult) {
      send({
        type: 'run:complete',
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        total: result.total,
        duration: result.duration,
      });
    },
  };
}
