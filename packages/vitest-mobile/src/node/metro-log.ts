/**
 * metro-log — redirect Metro's own output to a file instead of the terminal.
 *
 * Metro runs programmatically inside the pool process, and `TerminalReporter`
 * is the sole path by which it writes to stdout: bundle progress, the
 * "Welcome to Metro" banner, device-forwarded `client_log` events,
 * jest-worker stderr chunks, compile errors, etc. By installing a
 * `Reporter` whose sink is a file stream we keep the terminal clean
 * (only the pool's own `[vitest-mobile] …` status lines stay visible),
 * while retaining every Metro signal in `<instanceDir>/metro.log` for
 * post-hoc debugging.
 *
 * Coverage note: events the reporter doesn't explicitly format fall
 * through to a JSON dump so we never silently drop new Metro event
 * types as the package evolves.
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Reporter } from 'metro';

export interface MetroLogTap {
  /** Absolute path to the on-disk log file. */
  readonly path: string;
  /** A Metro-compatible reporter that writes every event into {@link path}. */
  readonly reporter: Reporter;
  /** Flush and close the underlying stream. Safe to call multiple times. */
  close(): Promise<void>;
}

// Matches ANSI CSI / OSC / simple escape sequences that may sneak in via
// third-party tool output (e.g. error messages formatted with chalk).
// Good enough to keep the file readable — not a full ECMA-48 parser.
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '');
}

function serializeError(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) {
    return err.stack ? err.stack : `${err.name}: ${err.message}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Open a `metro.log` file at `logPath` (truncated on each boot) and
 * return a Metro-compatible reporter that streams events to it.
 */
export function attachMetroLogTap(logPath: string): MetroLogTap {
  mkdirSync(dirname(logPath), { recursive: true });
  const stream = createWriteStream(logPath, { flags: 'w' });

  function write(line: string): void {
    try {
      stream.write(line.endsWith('\n') ? stripAnsi(line) : stripAnsi(line) + '\n');
    } catch {
      /* swallow — a failing log must not crash Metro */
    }
  }

  // Event-level formatter. Covers the types `TerminalReporter._log`
  // actually renders; everything else falls through to a JSON dump so
  // unknown/new event types aren't lost.
  const reporter: Reporter = {
    update(event) {
      if (!event || typeof event !== 'object') return;
      const ev = event as Record<string, unknown>;
      switch (ev.type) {
        // Noise from Metro's startup banner / logo — explicitly silent.
        case 'initialize_started':
        case 'initialize_done':
        case 'dep_graph_loading':
        case 'dep_graph_loaded':
        case 'transformer_load_started':
        case 'transformer_load_done':
        case 'server_listening':
        case 'watcher_status':
        case 'watcher_health_check_result':
          return;
        // Bundle build lifecycle — one line per phase is plenty.
        case 'bundle_build_started': {
          const details = ev.bundleDetails as { entryFile?: string; platform?: string; dev?: boolean } | undefined;
          write(
            `[metro] bundle start buildID=${ev.buildID} platform=${details?.platform ?? '?'} entry=${details?.entryFile ?? '?'}`,
          );
          return;
        }
        case 'bundle_transform_progressed':
          // Per-module progress spam — skip.
          return;
        case 'bundle_build_done':
          write(`[metro] bundle done  buildID=${ev.buildID}`);
          return;
        case 'bundle_build_failed':
          write(`[metro] bundle FAILED buildID=${ev.buildID}`);
          return;
        case 'bundling_error':
          write(`[metro] bundling error: ${serializeError(ev.error)}`);
          return;
        case 'resolver_warning':
          write(`[metro:warn] ${ev.message}`);
          return;
        case 'transform_cache_reset':
          write(`[metro] transform cache was reset`);
          return;
        case 'hmr_client_error':
          write(`[metro:hmr] client error: ${serializeError(ev.error)}`);
          return;
        // Jest-worker transform child stdout/stderr — crucial for
        // diagnosing plugin errors. `chunk` already ends with a newline.
        case 'worker_stdout_chunk':
          write(`[worker:stdout] ${String(ev.chunk ?? '').replace(/\n$/, '')}`);
          return;
        case 'worker_stderr_chunk':
          write(`[worker:stderr] ${String(ev.chunk ?? '').replace(/\n$/, '')}`);
          return;
        // Device-forwarded console output — the only place these land.
        case 'client_log': {
          const level = typeof ev.level === 'string' ? ev.level : 'log';
          const data = Array.isArray(ev.data) ? ev.data : [];
          write(`[device:${level}] ${data.map(d => (typeof d === 'string' ? d : String(d))).join(' ')}`);
          return;
        }
        case 'unstable_server_log': {
          const level = typeof ev.level === 'string' ? ev.level : 'info';
          const data = Array.isArray(ev.data) ? ev.data : [ev.data];
          write(`[metro:${level}] ${data.map(d => (typeof d === 'string' ? d : String(d))).join(' ')}`);
          return;
        }
        case 'bundle_save_log':
          write(`[metro] LOG: ${ev.message}`);
          return;
        // Unknown event — dump so it's searchable but not silently dropped.
        default:
          try {
            write(`[metro:${String(ev.type)}] ${JSON.stringify(ev)}`);
          } catch {
            write(`[metro:${String(ev.type)}] <unserializable event>`);
          }
      }
    },
  };

  let closed = false;
  return {
    path: logPath,
    reporter,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>(resolve => stream.end(resolve));
    },
  };
}
