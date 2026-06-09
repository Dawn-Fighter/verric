// Background worker that drives a queued run through the engine.
//
// Called from /api/generate-report's POST handler as fire-and-forget
// (the route returns 202 + runId immediately; the worker keeps running
// after the response is sent because we're a long-lived Node process,
// not a serverless function). For Vercel-style serverless we'd swap
// this for a real queue + cron worker; the engine + storage interfaces
// don't change.
//
// Each progress event is BOTH persisted (so a fresh SSE connection can
// replay history) AND broadcast over the in-process bus (so live
// subscribers get push). On terminal states we update the run row and
// emit a terminal event to wake any waiting SSE clients.

import {
  LLMProviderError,
  VerricEngineError,
  runReport,
  type LLMProvider,
  type RunProgressEvent
} from "@verric/core";
import {
  appendRunEvent,
  completeRunFailure,
  completeRunSuccess,
  getRun,
  markRunRunning,
  type Database
} from "@verric/storage";
import { emitRunEvent, emitRunTerminal } from "./run-bus";

export interface ProcessRunInput {
  runId: string;
  provider: LLMProvider;
  signingKey: string;
  template?: string;
}

/**
 * Drive a run through the engine. Errors are caught and recorded — this
 * function does not throw to its caller. (It's called fire-and-forget
 * from the route handler; nothing is left to catch them.)
 */
export async function processRun(db: Database, input: ProcessRunInput): Promise<void> {
  const { runId, provider, signingKey } = input;
  const template = input.template ?? "pentest@0.1.0";

  // Atomically claim the run. If another worker (or HMR re-import)
  // already started it, bail.
  const claimed = markRunRunning(db, runId);
  if (!claimed) {
    return;
  }

  // Pull the queued run + its evidence snapshot.
  const run = getRun(db, runId);
  if (!run) {
    completeRunFailure(db, {
      runId,
      status: "failed",
      stage: "load",
      message: "Run row vanished between queue and worker"
    });
    emitRunTerminal(runId, "failed", "load", "Run row vanished between queue and worker");
    return;
  }

  const onProgress = (ev: RunProgressEvent) => {
    try {
      const row = appendRunEvent(db, runId, ev);
      emitRunEvent(runId, row);
    } catch (err) {
      // Persistence/observability hooks must not break the engine.
      console.error("appendRunEvent failed (non-fatal):", err);
    }
  };

  try {
    const result = await runReport({
      project: run.project,
      artifacts: run.artifacts,
      chunks: run.chunks,
      provider,
      template,
      signingKey,
      onProgress
    });

    completeRunSuccess(db, {
      runId,
      durationMs: result.metadata.durationMs,
      canaryTriggered: result.metadata.canaryTriggered,
      verifierFailed: result.metadata.verifierFailed,
      model: result.metadata.drafterModel,
      report: result.report,
      verdicts: result.verdicts.length > 0 ? result.verdicts : null,
      receipt: result.receipt
    });
    emitRunTerminal(runId, "succeeded");
  } catch (err) {
    if (err instanceof VerricEngineError) {
      const status = err.stage === "canary_triggered" ? "canary_triggered" : "failed";
      completeRunFailure(db, {
        runId,
        status,
        stage: err.stage,
        message: err.message,
        canaryTriggered: status === "canary_triggered"
      });
      emitRunTerminal(runId, status, err.stage, err.message);
      return;
    }
    if (err instanceof LLMProviderError) {
      completeRunFailure(db, {
        runId,
        status: "failed",
        stage: `provider:${err.providerId}`,
        message: err.message
      });
      emitRunTerminal(runId, "failed", `provider:${err.providerId}`, err.message);
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    completeRunFailure(db, {
      runId,
      status: "failed",
      stage: "unknown",
      message: detail
    });
    emitRunTerminal(runId, "failed", "unknown", detail);
  }
}
