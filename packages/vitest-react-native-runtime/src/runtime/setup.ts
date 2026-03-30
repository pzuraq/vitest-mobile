/**
 * Runtime setup — connects the RN app to the Vitest pool over WebSocket.
 */

import { createBirpc } from 'birpc';
import { stringify as flatStringify, parse as flatParse } from 'flatted';
import { startTests, collectTests } from '@vitest/runner';
import { ReactNativeRunner } from './runner';
import { symbolicateStack } from './symbolicate';

let ws: WebSocket | null = null;
let vitestRpc: any = null;
let storedConfig: any = null;

// ── Status event system for UI ────────────────────────────────────

type StatusListener = (status: HarnessStatus) => void;
const statusListeners: Set<StatusListener> = new Set();

export interface HarnessStatus {
  state: 'connecting' | 'connected' | 'running' | 'done' | 'error';
  message: string;
  passed?: number;
  failed?: number;
  total?: number;
  logs?: string[];
}

let currentStatus: HarnessStatus = { state: 'connecting', message: 'Connecting to Vitest...' };
const logs: string[] = [];

function setStatus(status: Partial<HarnessStatus>) {
  currentStatus = { ...currentStatus, ...status };
  statusListeners.forEach(fn => fn(currentStatus));
}

function addLog(line: string) {
  logs.push(line);
  setStatus({ logs: [...logs] });
}

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => statusListeners.delete(listener);
}

// ── WebSocket transport ───────────────────────────────────────────

function wsSend(data: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}

function sendResponse(response: any) {
  wsSend(flatStringify({ __vitest_worker_response__: true, ...response }));
}

// ── Test execution handlers ───────────────────────────────────────

let passed = 0;
let failed = 0;

async function handleRun(context: any) {
  const files = context.files;
  const fileCount = files?.length ?? 0;
  setStatus({ state: 'running', message: `Running ${fileCount} test file(s)...` });
  passed = 0;
  failed = 0;
  logs.length = 0;

  try {
    const config = storedConfig ??
      context.config ?? {
        root: '.',
        setupFiles: [],
        name: undefined,
        passWithNoTests: false,
        testNamePattern: undefined,
        allowOnly: false,
        sequence: { seed: 0, hooks: 'stack', setupFiles: 'list' },
        chaiConfig: undefined,
        maxConcurrency: 1,
        testTimeout: 10000,
        hookTimeout: 10000,
        retry: 0,
        includeTaskLocation: false,
        tags: [],
        tagsFilter: undefined,
        strictTags: false,
      };

    const runner = new ReactNativeRunner(config, vitestRpc, test => {
      // Callback for each test completion — update UI
      const name = test.name ?? '?';
      const state = test.result?.state ?? 'unknown';
      const duration = test.result?.duration ?? 0;
      if (state === 'pass') {
        passed++;
        addLog(`✓ ${name} (${duration}ms)`);
      } else {
        failed++;
        const errMsg = test.result?.errors?.[0]?.message ?? 'unknown error';
        addLog(`✗ ${name} (${duration}ms)\n  ${errMsg}`);
      }
      setStatus({ passed, failed, total: passed + failed });
    });

    await startTests(files ?? [], runner);
  } catch (err: any) {
    console.error('[vitest-react-native-runtime] Run error:', err);
    addLog(`ERROR: ${err?.message}`);
    setStatus({ state: 'error', message: err?.message ?? 'Unknown error' });
    try {
      const stack = err?.stack ? await symbolicateStack(err.stack) : err?.stack;
      vitestRpc?.onUnhandledError({ message: err?.message, stack, name: err?.name }, 'Unhandled Error');
    } catch {
      /* ignore symbolication errors */
    }
  }

  setStatus({
    state: 'done',
    message: `Done: ${passed} passed, ${failed} failed`,
    passed,
    failed,
    total: passed + failed,
  });

  await new Promise(r => setTimeout(r, 500));
  sendResponse({ type: 'testfileFinished' });
}

async function handleCollect(context: any) {
  const files = context.files;
  setStatus({ state: 'running', message: `Collecting ${files?.length ?? 0} file(s)...` });

  try {
    const config = context.config ?? {};
    const runner = new ReactNativeRunner(config, vitestRpc);
    await collectTests(files ?? [], runner);
  } catch (err: any) {
    console.error('[vitest-react-native-runtime] Collect error:', err);
  }

  sendResponse({ type: 'testfileFinished' });
}

// ── Connect to Vitest ─────────────────────────────────────────────

export interface ConnectOptions {
  port?: number;
  host?: string;
}

export function connectToVitest(options: ConnectOptions = {}) {
  const port = options.port ?? 7878;
  const host = options.host ?? '127.0.0.1';
  const url = `ws://${host}:${port}`;
  const maxRetries = 30;
  let retryCount = 0;

  let pendingMessages: string[] = [];
  let birpcHandler: ((data: string) => void) | null = null;

  function tryConnect() {
    // Don't open a new connection if we already have a live one
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    setStatus({ state: 'connecting', message: `Connecting to Vitest... (${retryCount + 1})` });
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[vitest-react-native-runtime] Connected to Vitest');
      setStatus({ state: 'connected', message: 'Connected to Vitest' });
      retryCount = 0;

      vitestRpc = createBirpc(
        {
          onCancel(reason: string) {
            console.log(`[vitest-react-native-runtime] Cancelled: ${reason}`);
          },
        } as any,
        {
          post: data => wsSend(data),
          on: handler => {
            birpcHandler = handler;
            for (const msg of pendingMessages) handler(msg);
            pendingMessages = [];
          },
          serialize: v => {
            // Use flatted to preserve circular references (File ↔ Suite ↔ Test)
            try {
              return flatStringify(v);
            } catch (e) {
              console.error('[vitest-react-native-runtime] serialize error:', e);
              return JSON.stringify(null);
            }
          },
          deserialize: v => {
            try {
              return flatParse(v as string);
            } catch {
              // Fallback — incoming messages from Vitest use regular JSON
              return JSON.parse(v as string);
            }
          },
          timeout: -1,
        },
      );
    };

    ws.onmessage = event => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      try {
        // Messages from the pool are flatted-encoded
        let msg;
        try {
          msg = flatParse(raw);
        } catch {
          msg = JSON.parse(raw);
        }
        if (msg.__vitest_worker_request__) {
          switch (msg.type) {
            case 'start':
              if (msg.context?.config) {
                storedConfig = msg.context.config;
              }
              sendResponse({ type: 'started' });
              break;
            case 'run':
              handleRun(msg.context);
              break;
            case 'collect':
              handleCollect(msg.context);
              break;
            case 'cancel':
              break;
            case 'stop':
              sendResponse({ type: 'stopped' });
              break;
          }
          return;
        }
        if (birpcHandler) {
          birpcHandler(raw);
        } else {
          pendingMessages.push(raw);
        }
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onerror = () => {
      if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(tryConnect, 1000);
      } else {
        setStatus({ state: 'error', message: 'Could not connect to Vitest' });
      }
    };

    ws.onclose = () => {
      const wasConnected = vitestRpc !== null;
      ws = null;
      vitestRpc = null;
      birpcHandler = null;
      if (wasConnected) {
        // Was connected and got disconnected — vitest cycle ended.
        // Reconnect with backoff so we pick up the next watch cycle.
        console.log('[vitest-react-native-runtime] Disconnected from Vitest, waiting to reconnect...');
        retryCount = 0;
        setTimeout(tryConnect, 2000);
      }
      // If we were never fully connected (just a failed attempt),
      // onerror already handles retries — don't double-reconnect.
    };
  }

  tryConnect();
}
