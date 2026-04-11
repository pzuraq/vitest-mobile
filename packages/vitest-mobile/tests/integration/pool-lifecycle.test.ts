import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { parse as flatParse } from 'flatted';

vi.mock('../../src/node/environment', () => ({
  checkEnvironment: vi.fn(() => ({ ok: true, checks: [], issues: [] })),
}));

vi.mock('../../src/node/device', () => ({
  ensureDevice: vi.fn(async () => {}),
  launchApp: vi.fn(),
  stopApp: vi.fn(),
}));

import { createNativePoolWorker } from '../../src/node/pool';
import { checkEnvironment } from '../../src/node/environment';
import { ensureDevice } from '../../src/node/device';
import type { NativePoolOptions } from '../../src/node/types';

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(err => (err ? reject(err) : resolve(port)));
    });
    s.on('error', reject);
  });
}

function poolOptions(port: number, metroPort: number, appDir: string): NativePoolOptions {
  return {
    port,
    metroPort,
    platform: 'android',
    bundleId: 'com.vitest.mobile.harness',
    appDir,
    skipIfUnavailable: false,
    headless: true,
    shutdownEmulator: false,
    verbose: false,
    mode: 'run',
    testInclude: ['**/*.test.ts'],
  };
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 25_000;
    const attempt = (): void => {
      if (Date.now() > deadline) {
        reject(new Error('WebSocket connect timeout'));
        return;
      }
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.once('open', () => resolve(ws));
      ws.once('error', () => setTimeout(attempt, 30));
    };
    attempt();
  });
}

describe('createNativePoolWorker lifecycle (mocked device / Metro / binary)', () => {
  let appDir: string;
  let metroPort: number;
  const clients: WebSocket[] = [];
  let worker: ReturnType<typeof createNativePoolWorker> | null = null;

  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), 'vitest-mobile-'));
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          text: async () => 'packager-status:running',
        } as Response),
      ),
    );
    vi.mocked(checkEnvironment).mockClear();
    vi.mocked(ensureDevice).mockClear();
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        c.removeAllListeners();
        c.close();
      } catch {
        /* ignore */
      }
    }
    if (worker) {
      try {
        await worker.stop();
      } catch {
        /* ignore */
      }
      worker = null;
    }
    vi.unstubAllGlobals();
  });

  it('returns a worker with name, on, off, send, start, stop', async () => {
    const port = await reservePort();
    metroPort = await reservePort();
    worker = createNativePoolWorker(poolOptions(port, metroPort, appDir));

    expect(worker.name).toBe('native');
    expect(typeof worker.on).toBe('function');
    expect(typeof worker.off).toBe('function');
    expect(typeof worker.send).toBe('function');
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.stop).toBe('function');
  });

  it('start() runs environment check and device setup when Metro is already “up” (fetch mock)', async () => {
    const port = await reservePort();
    metroPort = await reservePort();
    worker = createNativePoolWorker(poolOptions(port, metroPort, appDir));

    const startP = worker.start();
    const ws = await connectWs(port);
    clients.push(ws);
    await startP;

    expect(vi.mocked(checkEnvironment)).toHaveBeenCalled();
    expect(vi.mocked(ensureDevice)).toHaveBeenCalled();
  });

  it('send() forwards non-birpc payloads to the connected WebSocket client', async () => {
    const port = await reservePort();
    metroPort = await reservePort();
    worker = createNativePoolWorker(poolOptions(port, metroPort, appDir));

    const startP = worker.start();
    const ws = await connectWs(port);
    clients.push(ws);

    const received = new Promise<unknown>(resolve => {
      ws.once('message', data => {
        resolve(flatParse(data.toString()));
      });
    });

    await startP;

    worker.send({ type: 'test' } as Parameters<typeof worker.send>[0]);
    const msg = await received;
    expect(msg).toMatchObject({ type: 'test' });
  });

  it('on/off correctly adds and removes listeners', async () => {
    const port = await reservePort();
    metroPort = await reservePort();
    worker = createNativePoolWorker(poolOptions(port, metroPort, appDir));

    const startP = worker.start();
    const ws = await connectWs(port);
    clients.push(ws);
    await startP;

    const received: unknown[] = [];
    const listener = (data: unknown) => received.push(data);
    worker.on('message', listener);

    // Trigger emit() by having the WS client send a raw message to the pool —
    // the pool's socket.on('message') handler parses it and calls _currentEmit('message', msg).
    ws.send(JSON.stringify({ ping: 1 }));
    await new Promise(r => setTimeout(r, 100));
    const countAfterOn = received.length;
    expect(countAfterOn).toBeGreaterThan(0);

    // Remove the listener, send another message, and confirm it no longer fires.
    worker.off('message', listener);
    ws.send(JSON.stringify({ ping: 2 }));
    await new Promise(r => setTimeout(r, 100));
    expect(received.length).toBe(countAfterOn);
  });

  it('stop() emits a stopped worker response on message', async () => {
    const port = await reservePort();
    metroPort = await reservePort();
    worker = createNativePoolWorker(poolOptions(port, metroPort, appDir));

    const startP = worker.start();
    const ws = await connectWs(port);
    clients.push(ws);
    await startP;

    const stopped = new Promise<unknown>(resolve => {
      worker!.on('message', data => {
        const m = data as { type?: string; __vitest_worker_response__?: boolean };
        if (m?.__vitest_worker_response__ && m.type === 'stopped') resolve(data);
      });
    });

    await worker.stop();
    const msg = await stopped;
    expect(msg).toEqual(
      expect.objectContaining({
        __vitest_worker_response__: true,
        type: 'stopped',
      }),
    );
    worker = null;
  });
});
