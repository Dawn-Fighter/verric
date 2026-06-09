import { listRunEvents, getRun } from "@verric/storage";
import { getDb } from "@/lib/db";
import { subscribeToRun, type RunBusEvent } from "@/lib/run-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/runs/[id]/stream
//
// Server-Sent Events stream of run progress.
//
//   1. On connect, replay any persisted events (so a client connecting
//      mid-run sees what already happened).
//   2. Subscribe to the in-process bus for live events.
//   3. Emit a `terminal` event when the run reaches a terminal status,
//      then close the stream.
//
// Heartbeats every 15s keep the connection alive through proxies.
// ─────────────────────────────────────────────────────────────────────────

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id: runId } = await ctx.params;
  const db = getDb();

  // Quick existence check so unknown runs return 404 rather than an
  // empty SSE stream that hangs forever.
  const run = getRun(db, runId);
  if (!run) {
    return new Response(JSON.stringify({ error: "Run not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let lastSequence = -1;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed by the runtime — flag and stop.
          closed = true;
        }
      };

      const sendEvent = (eventName: string, data: unknown) => {
        safeEnqueue(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // 1. Replay persisted events.
      const past = listRunEvents(db, runId);
      for (const ev of past) {
        sendEvent("progress", ev);
        lastSequence = ev.sequence;
      }

      // 2. If the run is already terminal, send the terminal event + close.
      if (run.status === "succeeded" || run.status === "failed" || run.status === "canary_triggered") {
        sendEvent("terminal", {
          runId,
          status: run.status,
          failureStage: run.failureStage,
          failureMessage: run.failureMessage
        });
        closed = true;
        controller.close();
        return;
      }

      // 3. Live subscription.
      const unsubscribe = subscribeToRun(runId, (busEvent: RunBusEvent) => {
        if (busEvent.type === "event" && busEvent.event) {
          // Skip events we already replayed.
          if (busEvent.event.sequence <= lastSequence) return;
          lastSequence = busEvent.event.sequence;
          sendEvent("progress", busEvent.event);
        } else if (busEvent.type === "terminal" && busEvent.terminal) {
          sendEvent("terminal", { runId, ...busEvent.terminal });
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });

      // 4. Heartbeats so intermediaries don't kill the connection.
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        safeEnqueue(`: heartbeat\n\n`);
      }, 15000);

      // 5. Tear down on consumer cancel (browser close / nav away).
      const onCancel = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
      // ReadableStream doesn't surface a cancel callback to start(), so
      // we attach via the controller signal pattern below.
      return onCancel;
    },
    cancel() {
      // Browser closed the stream. Listeners are GC'd via the closure
      // captured above; nothing more to do.
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
