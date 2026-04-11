/**
 * Runtime polyfills that must run before loading certain dependencies.
 */

import { g } from './global-types';

function ensureStructuredClonePolyfill(): void {
  if (typeof structuredClone !== 'undefined') return;

  const fallback = <T>(value: T): T => {
    // Explorer state trees are plain JSON-serializable objects.
    return JSON.parse(JSON.stringify(value)) as T;
  };

  (g as unknown as { structuredClone?: typeof structuredClone }).structuredClone =
    fallback as unknown as typeof structuredClone;
}

function ensureDOMExceptionPolyfill(): void {
  if (typeof DOMException !== 'undefined') return;

  class DOMExceptionPolyfill extends Error {
    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
    }
  }

  (g as unknown as { DOMException?: typeof DOMException }).DOMException =
    DOMExceptionPolyfill as unknown as typeof DOMException;
}

export function ensureRuntimePolyfills(): void {
  ensureStructuredClonePolyfill();
  ensureDOMExceptionPolyfill();

  // Chai 6.x uses EventTarget for plugin events. Hermes doesn't provide it.
  if (typeof EventTarget === 'undefined') {
    g.Event = class Event {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    } as typeof globalThis.Event;

    g.EventTarget = class EventTarget {
      private _listeners: Record<string, Function[]> = {};

      addEventListener(type: string, listener: Function) {
        (this._listeners[type] ??= []).push(listener);
      }

      removeEventListener(type: string, listener: Function) {
        const list = this._listeners[type];
        if (list) this._listeners[type] = list.filter(l => l !== listener);
      }

      dispatchEvent(event: { type: string }) {
        for (const listener of this._listeners[event.type] ?? []) listener(event);
        return true;
      }
    } as unknown as typeof globalThis.EventTarget;
  }
}

// Ensure polyfills are applied as soon as this module is loaded.
ensureRuntimePolyfills();
