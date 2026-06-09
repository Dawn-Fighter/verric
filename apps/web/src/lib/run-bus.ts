// Tiny in-process pub/sub for run progress events.
//
// The worker emits an event each time the engine progresses; each SSE
// connection subscribes to the bus filtered by runId. When the run
// completes, the bus emits one final terminal event so subscribers
// know to close.
//
// Lives in apps/web (not @verric/storage) because pub/sub is a
// process-local concern, not a persistence concern. For a multi-process
// deployment we'd swap this for Postgres LISTEN/NOTIFY or Redis pubsub;
// the interface stays the same.
//
// We stash the bus on globalThis so dev-server HMR doesn't accidentally
// fork it into multiple instances.

import { EventEmitter } from "node:events";
import type { RunEventRow } from "@verric/storage";

export type TerminalStatus = "succeeded" | "failed" | "canary_triggered";

export interface RunBusEvent {
  /** "event" carries the next progress event; "terminal" signals run completion. */
  type: "event" | "terminal";
  runId: string;
  event?: RunEventRow;
  terminal?: { status: TerminalStatus; failureStage?: string | null; failureMessage?: string | null };
}

declare global {
  var __verricRunBus: EventEmitter | undefined;
}

export function getRunBus(): EventEmitter {
  if (globalThis.__verricRunBus) return globalThis.__verricRunBus;
  const bus = new EventEmitter();
  // SSE clients add listeners; allow many.
  bus.setMaxListeners(0);
  globalThis.__verricRunBus = bus;
  return bus;
}

export function emitRunEvent(runId: string, event: RunEventRow): void {
  getRunBus().emit(runId, { type: "event", runId, event } satisfies RunBusEvent);
}

export function emitRunTerminal(
  runId: string,
  status: TerminalStatus,
  failureStage: string | null = null,
  failureMessage: string | null = null
): void {
  getRunBus().emit(runId, {
    type: "terminal",
    runId,
    terminal: { status, failureStage, failureMessage }
  } satisfies RunBusEvent);
}

export function subscribeToRun(runId: string, listener: (e: RunBusEvent) => void): () => void {
  const bus = getRunBus();
  bus.on(runId, listener);
  return () => {
    bus.off(runId, listener);
  };
}
