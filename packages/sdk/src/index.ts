// Typed Verric REST/SSE client. Works in Node 22+ and any browser (uses
// the standard fetch + EventSource APIs; no axios/got pulled in).
//
// Lifetime: a VerricClient holds a base URL + optional auth header. It's
// safe to keep one instance around for the life of the app.

import type {
  EvidenceArtifact,
  EvidenceChunk,
  GroundingVerdict,
  ProjectDetails,
  Receipt,
  RunProgressEvent,
  VerricReport
} from "@verric/core";

// ─────────────────────────────────────────────────────────────────────────
// Wire types — mirror the server's JSON responses
// ─────────────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok" | "degraded" | "error";
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  dbPath: string;
  provider: string;
  elapsedMs: number;
}

export interface CreateRunResponse {
  runId: string;
  statusUrl: string;
  streamUrl: string;
  mode: string;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canary_triggered";

export interface RunSummary {
  id: string;
  projectId: string;
  template: string;
  providerId: string;
  model: string;
  status: RunStatus;
  failureStage: string | null;
  failureMessage: string | null;
  durationMs: number | null;
  canaryTriggered: boolean;
  verifierFailed: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface RunDetail extends RunSummary {
  project: ProjectDetails;
  chunks: EvidenceChunk[];
  artifacts: EvidenceArtifact[];
  report: VerricReport | null;
  verdicts: GroundingVerdict[] | null;
  receipt: Receipt | null;
}

export interface ListRunsResponse {
  runs: RunSummary[];
  count: number;
}

export interface SSEProgressEvent {
  runId: string;
  sequence: number;
  stage: RunProgressEvent["stage"];
  message: string;
  elapsedMs: number;
  data: Record<string, unknown> | null;
  createdAt: number;
}

export interface SSETerminalEvent {
  runId: string;
  status: "succeeded" | "failed" | "canary_triggered";
  failureStage: string | null;
  failureMessage: string | null;
}

export class VerricClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "VerricClientError";
  }
}

export interface VerricClientOptions {
  /** Base URL, e.g. "http://localhost:3000". Defaults to current origin in browsers. */
  baseUrl?: string;
  /**
   * Optional bearer token / API key. Sent as `Authorization: Bearer <token>`.
   * Not yet enforced by the server (auth ships in P2.x), but the SDK
   * surface area is ready for it.
   */
  token?: string;
  /** Override fetch (for tests). */
  fetch?: typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────

export class VerricClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fx: typeof fetch;

  constructor(opts: VerricClientOptions = {}) {
    const inferred =
      typeof window !== "undefined" && window.location ? window.location.origin : "http://localhost:3000";
    this.baseUrl = (opts.baseUrl ?? inferred).replace(/\/$/, "");
    this.token = opts.token;
    this.fx = opts.fetch ?? fetch;
  }

  // ───────────────────────── health ─────────────────────────

  async health(): Promise<HealthResponse> {
    return this.json<HealthResponse>("GET", "/api/health");
  }

  // ───────────────────────── runs ─────────────────────────

  /**
   * Submit a run for processing. Returns immediately with a runId. The
   * actual report is generated asynchronously — use `streamRun(runId)`
   * for live progress or `waitForRun(runId)` to await completion.
   */
  async createRun(input: {
    project: ProjectDetails;
    chunks: EvidenceChunk[];
    artifacts: EvidenceArtifact[];
  }): Promise<CreateRunResponse> {
    return this.json<CreateRunResponse>("POST", "/api/generate-report", input);
  }

  async listRuns(
    opts: { projectId?: string; limit?: number; offset?: number } = {}
  ): Promise<ListRunsResponse> {
    const params = new URLSearchParams();
    if (opts.projectId) params.set("projectId", opts.projectId);
    if (typeof opts.limit === "number") params.set("limit", String(opts.limit));
    if (typeof opts.offset === "number") params.set("offset", String(opts.offset));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.json<ListRunsResponse>("GET", `/api/runs${qs}`);
  }

  async getRun(runId: string): Promise<RunDetail> {
    const wrapper = await this.json<{ run: RunDetail }>("GET", `/api/runs/${encodeURIComponent(runId)}`);
    return wrapper.run;
  }

  async deleteRun(runId: string): Promise<void> {
    await this.json<{ ok: true }>("DELETE", `/api/runs/${encodeURIComponent(runId)}`);
  }

  // ───────────────────────── streaming ─────────────────────────

  /**
   * Subscribe to a run's progress stream. Works in both browsers (uses
   * EventSource if available) and Node (uses fetch + manual SSE parser).
   *
   * Returns an unsubscribe function. The callbacks fire until the
   * terminal event arrives or the consumer unsubscribes.
   */
  streamRun(
    runId: string,
    handlers: {
      onProgress?: (event: SSEProgressEvent) => void;
      onTerminal?: (event: SSETerminalEvent) => void;
      onError?: (err: Error) => void;
    }
  ): () => void {
    const url = `${this.baseUrl}/api/runs/${encodeURIComponent(runId)}/stream`;
    if (typeof EventSource !== "undefined") {
      const es = new EventSource(url);
      es.addEventListener("progress", (msg) => {
        try {
          handlers.onProgress?.(JSON.parse((msg as MessageEvent).data) as SSEProgressEvent);
        } catch (err) {
          handlers.onError?.(err as Error);
        }
      });
      es.addEventListener("terminal", (msg) => {
        try {
          handlers.onTerminal?.(JSON.parse((msg as MessageEvent).data) as SSETerminalEvent);
        } catch (err) {
          handlers.onError?.(err as Error);
        }
        es.close();
      });
      es.onerror = () => handlers.onError?.(new Error("SSE stream error"));
      return () => es.close();
    }
    // Node path: fetch + ReadableStream + naive SSE chunker.
    const controller = new AbortController();
    void this.streamSseNode(url, controller.signal, handlers);
    return () => controller.abort();
  }

  /**
   * Convenience: subscribe to a run and resolve when it terminates.
   * Resolves with the terminal event; rejects on stream error.
   */
  waitForRun(runId: string, onProgress?: (event: SSEProgressEvent) => void): Promise<SSETerminalEvent> {
    return new Promise((resolve, reject) => {
      this.streamRun(runId, {
        onProgress,
        onTerminal: resolve,
        onError: reject
      });
    });
  }

  // ───────────────────────── private ─────────────────────────

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.fx(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const detail =
        (parsed as { detail?: string; error?: string } | undefined)?.detail ||
        (parsed as { error?: string } | undefined)?.error ||
        `HTTP ${res.status}`;
      throw new VerricClientError(detail, res.status, parsed);
    }
    return parsed as T;
  }

  private async streamSseNode(
    url: string,
    signal: AbortSignal,
    handlers: {
      onProgress?: (event: SSEProgressEvent) => void;
      onTerminal?: (event: SSETerminalEvent) => void;
      onError?: (err: Error) => void;
    }
  ): Promise<void> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await this.fx(url, { headers, signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      handlers.onError?.(err as Error);
      return;
    }
    if (!res.ok || !res.body) {
      handlers.onError?.(new VerricClientError(`SSE connect failed`, res.status));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          this.dispatchSse(block, handlers);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      handlers.onError?.(err as Error);
    }
  }

  private dispatchSse(
    block: string,
    handlers: {
      onProgress?: (event: SSEProgressEvent) => void;
      onTerminal?: (event: SSETerminalEvent) => void;
      onError?: (err: Error) => void;
    }
  ) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\n/)) {
      if (line.startsWith(":")) continue; // comment / heartbeat
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const dataStr = dataLines.join("\n");
    if (!dataStr) return;
    try {
      const parsed = JSON.parse(dataStr);
      if (eventName === "progress") handlers.onProgress?.(parsed as SSEProgressEvent);
      else if (eventName === "terminal") handlers.onTerminal?.(parsed as SSETerminalEvent);
    } catch (err) {
      handlers.onError?.(err as Error);
    }
  }
}

// Re-export the most common @verric/core types so consumers can
// `import { ProjectDetails, EvidenceChunk } from "@verric/sdk"` without
// pulling in the full engine.
export type {
  EvidenceArtifact,
  EvidenceChunk,
  GroundingVerdict,
  ProjectDetails,
  Receipt,
  RunProgressEvent,
  VerricReport
} from "@verric/core";
