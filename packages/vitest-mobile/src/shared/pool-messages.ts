/**
 * Pool ↔ device WebSocket protocol (logical message shapes).
 *
 * On the wire, every frame (including these and `__hello`) is `flatted`;
 * the Node pool and the RN connection each `flatParse` once and then apply
 * these guards. Each message has a string `type` discriminator; payloads
 * live under `data` when present. The {@link VitestWorkerRequest} interop
 * type is separate — it uses the `__vitest_worker_request__` sentinel, not
 * the `{ type }` subprotocol.
 */

// ── Device → Pool ─────────────────────────────────────────────────

export type DeviceUpdatePayload = {
  created: string[];
  deleted: string[];
  updated: string[];
  /**
   * Reconnect-replay: device lists every test path under `updated` and sets
   * this so the pool only honors the message when `acceptReconnectReplay` is true.
   */
  reconnect?: boolean;
};

export type DeviceMessage =
  | { type: 'pause'; data?: { label?: string; screenshot?: boolean } }
  | { type: 'pauseEnded' }
  | { type: 'screenshotRequest'; data: { requestId: string; name?: string } }
  | { type: 'update'; data: DeviceUpdatePayload };

type DeviceMessageType = DeviceMessage['type'];

// ── Pool → Device ─────────────────────────────────────────────────

export type PoolMessage =
  | { type: 'resume' }
  | { type: 'screenshotResponse'; data: { requestId: string; filePath?: string; error?: string } }
  | { type: 'error'; data: { message: string } };

type PoolMessageType = PoolMessage['type'];

// ── Guards ────────────────────────────────────────────────────────

const DEVICE_TYPES: ReadonlySet<string> = new Set<DeviceMessageType>([
  'pause',
  'pauseEnded',
  'screenshotRequest',
  'update',
]);
const POOL_TYPES: ReadonlySet<string> = new Set<PoolMessageType>(['resume', 'screenshotResponse', 'error']);

function hasStringType(msg: unknown): msg is { type: string } {
  return typeof msg === 'object' && msg !== null && typeof (msg as { type: unknown }).type === 'string';
}

export function isDeviceMessage(msg: unknown): msg is DeviceMessage {
  return hasStringType(msg) && DEVICE_TYPES.has(msg.type);
}

export function isPoolMessage(msg: unknown): msg is PoolMessage {
  return hasStringType(msg) && POOL_TYPES.has(msg.type);
}

// ── Vitest birpc framing (interop, not our protocol) ──────────────

export interface VitestWorkerContext {
  config?: Record<string, unknown> & {
    __poolMode?: string;
    testTimeout?: number;
    hookTimeout?: number;
  };
  files?: { filepath?: string }[];
}

export type VitestWorkerRequestType = 'start' | 'run' | 'collect' | 'cancel' | 'stop';

export interface VitestWorkerRequest {
  __vitest_worker_request__: true;
  type: VitestWorkerRequestType;
  context?: VitestWorkerContext;
}

export function isVitestWorkerRequest(msg: unknown): msg is VitestWorkerRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    '__vitest_worker_request__' in msg &&
    (msg as { __vitest_worker_request__?: unknown }).__vitest_worker_request__ === true
  );
}
