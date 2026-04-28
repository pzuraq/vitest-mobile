/**
 * WebSocket transport for the device ↔ pool link.
 *
 * Every frame is `flatted` (including simple `{ type }` control messages) so
 * the pool and device can always `flatParse` once and hand live objects to
 * subscribers. No protocol types — that lives in `control-bridge.ts`.
 */

import { parse as flatParse, stringify as flatStringify } from 'flatted';
import { getErrorMessage } from './global-types';
import { getRuntimeNetwork } from './network-config';
import { isConnected, setHarnessStatus } from './store';

type MessageHandler = (data: unknown) => void;
type OpenHandler = () => void;

/**
 * A single WebSocket, multiple subscribers, parse-once per inbound frame.
 */
export class DevicePoolConnection {
  private ws: WebSocket | null = null;
  private wasEverConnected = false;
  private retryCount = 0;
  private readonly maxRetries = 30;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly openHandlers = new Set<OpenHandler>();

  /** Subscribe to inbound messages (already `flatParse`d). */
  on(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }

  off(handler: MessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  onOpen(handler: OpenHandler): void {
    this.openHandlers.add(handler);
  }

  private notifyOpen(): void {
    for (const h of this.openHandlers) {
      try {
        h();
      } catch {
        /* isolate */
      }
    }
  }

  post(message: unknown): void {
    if (!this.isOpen()) return;
    try {
      this.ws!.send(flatStringify(message));
    } catch {
      /* ignore */
    }
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Stops the automatic reconnect / retry loop (e.g. duplicate-connection error from pool). */
  haltReconnection(): void {
    this.retryCount = this.maxRetries;
  }

  connect(): void {
    this.tryConnect();
  }

  private tryConnect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const { wsHost: host, wsPort: port } = getRuntimeNetwork();
    const url = `ws://${host}:${port}`;

    setHarnessStatus({ state: 'connecting', message: `Connecting to Vitest... (${this.retryCount + 1})` });
    isConnected.value = false;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      if (this.wasEverConnected) {
        console.log('[vitest-mobile] Reconnected — reloading for fresh state');
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
        try {
          const { NativeModules } = require('react-native') as {
            NativeModules: { DevSettings?: { reload?: () => void } };
          };
          NativeModules.DevSettings?.reload?.();
        } catch (e: unknown) {
          console.warn('[vitest-mobile] DevSettings.reload() failed:', getErrorMessage(e));
        }
        return;
      }
      this.wasEverConnected = true;

      this.notifyOpen();

      setHarnessStatus({ state: 'connected', message: 'Connected to Vitest' });
      isConnected.value = true;
      this.retryCount = 0;
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      let parsed: unknown;
      try {
        parsed = flatParse(raw);
      } catch {
        return;
      }
      for (const h of this.messageHandlers) {
        try {
          h(parsed);
        } catch {
          /* isolate */
        }
      }
    };

    this.ws.onerror = () => {
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        setTimeout(() => this.tryConnect(), 1000);
      } else {
        setHarnessStatus({ state: 'error', message: 'Could not connect to Vitest' });
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      isConnected.value = false;
      if (this.wasEverConnected) {
        console.log('[vitest-mobile] Disconnected from Vitest, waiting to reconnect...');
        this.retryCount = 0;
        setTimeout(() => this.tryConnect(), 2000);
      }
    };
  }
}

// Minimal typing for RN / test environments
interface WebSocketMessageEvent {
  data: string;
}
