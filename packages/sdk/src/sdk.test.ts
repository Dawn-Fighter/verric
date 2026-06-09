import { describe, expect, it, vi } from "vitest";
import { VerricClient } from "./index";

// SDK tests use a fake fetch so we can assert the wire shape without
// booting the real server.

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) =>
    handler(String(url), init ?? {})
  ) as unknown as typeof fetch;
}

describe("VerricClient — REST", () => {
  it("health() hits /api/health and parses the response", async () => {
    const fx = fakeFetch(async (url) => {
      expect(url).toBe("http://localhost:3000/api/health");
      return new Response(
        JSON.stringify({
          status: "ok",
          schemaVersion: 2,
          expectedSchemaVersion: 2,
          dbPath: "verric.db",
          provider: "ollama",
          elapsedMs: 1
        }),
        { status: 200 }
      );
    });
    const client = new VerricClient({ baseUrl: "http://localhost:3000", fetch: fx });
    const out = await client.health();
    expect(out.status).toBe("ok");
    expect(out.schemaVersion).toBe(2);
  });

  it("createRun POSTs JSON and returns the 202 wire shape", async () => {
    const fx = fakeFetch(async (url, init) => {
      expect(url).toBe("http://localhost:3000/api/generate-report");
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body));
      expect(body.project.clientName).toBe("Acme");
      return new Response(
        JSON.stringify({
          runId: "abc",
          statusUrl: "http://localhost:3000/api/runs/abc",
          streamUrl: "http://localhost:3000/api/runs/abc/stream",
          mode: "ollama"
        }),
        { status: 202 }
      );
    });
    const client = new VerricClient({ baseUrl: "http://localhost:3000", fetch: fx });
    const out = await client.createRun({
      project: {
        clientName: "Acme",
        projectName: "x",
        assessmentType: "WAPT",
        preparedBy: "v",
        testerName: "v",
        classification: "Confidential",
        startDate: "2026-06-08",
        endDate: "2026-06-08",
        reportDate: "2026-06-08",
        scope: "x",
        outOfScope: "x",
        rulesOfEngagement: "x",
        methodology: "x",
        toolsUsed: "x"
      },
      chunks: [{ id: "ev-001", artifactId: "a", artifactName: "a.txt", lineStart: 1, lineEnd: 1, text: "x" }],
      artifacts: []
    });
    expect(out.runId).toBe("abc");
    expect(out.mode).toBe("ollama");
  });

  it("listRuns serializes query params correctly", async () => {
    const seen: string[] = [];
    const fx = fakeFetch(async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ runs: [], count: 0 }), { status: 200 });
    });
    const client = new VerricClient({ baseUrl: "http://x", fetch: fx });
    await client.listRuns({ projectId: "p1", limit: 25, offset: 50 });
    expect(seen[0]).toBe("http://x/api/runs?projectId=p1&limit=25&offset=50");
  });

  it("getRun unwraps the {run: ...} envelope", async () => {
    const fx = fakeFetch(
      async () => new Response(JSON.stringify({ run: { id: "abc", status: "succeeded" } }), { status: 200 })
    );
    const client = new VerricClient({ baseUrl: "http://x", fetch: fx });
    const run = (await client.getRun("abc")) as { id: string; status: string };
    expect(run.id).toBe("abc");
    expect(run.status).toBe("succeeded");
  });

  it("throws VerricClientError on non-2xx with detail extraction", async () => {
    const fx = fakeFetch(
      async () =>
        new Response(JSON.stringify({ error: "Provider not configured", detail: "no api key" }), {
          status: 500
        })
    );
    const client = new VerricClient({ baseUrl: "http://x", fetch: fx });
    await expect(
      client.createRun({
        project: {
          clientName: "Acme",
          projectName: "x",
          assessmentType: "x",
          preparedBy: "x",
          testerName: "x",
          classification: "x",
          startDate: "x",
          endDate: "x",
          reportDate: "x",
          scope: "x",
          outOfScope: "x",
          rulesOfEngagement: "x",
          methodology: "x",
          toolsUsed: "x"
        },
        chunks: [],
        artifacts: []
      })
    ).rejects.toMatchObject({ status: 500, message: "no api key" });
  });

  it("attaches Authorization header when token is configured", async () => {
    let captured: Record<string, string> = {};
    const fx = fakeFetch(async (_url, init) => {
      captured = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    const client = new VerricClient({ baseUrl: "http://x", token: "secret", fetch: fx });
    await client.health();
    expect(captured.Authorization).toBe("Bearer secret");
  });
});

describe("VerricClient — Node SSE streaming", () => {
  it("parses progress + terminal events from a streamed body", async () => {
    // Build a synthetic SSE stream the way the server would.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            `event: progress\ndata: ${JSON.stringify({
              runId: "r",
              sequence: 0,
              stage: "started",
              message: "go",
              elapsedMs: 0,
              data: null,
              createdAt: 1
            })}\n\n`
          )
        );
        controller.enqueue(
          enc.encode(
            `event: terminal\ndata: ${JSON.stringify({
              runId: "r",
              status: "succeeded",
              failureStage: null,
              failureMessage: null
            })}\n\n`
          )
        );
        controller.close();
      }
    });
    const fx = fakeFetch(async () => new Response(body, { status: 200 }));
    const client = new VerricClient({ baseUrl: "http://x", fetch: fx });

    const progresses: unknown[] = [];
    const terminal = await new Promise<unknown>((resolve, reject) => {
      // Force the Node fetch path by stubbing out EventSource.
      const orig = (globalThis as { EventSource?: unknown }).EventSource;
      (globalThis as { EventSource?: unknown }).EventSource = undefined;
      try {
        client.streamRun("r", {
          onProgress: (e) => progresses.push(e),
          onTerminal: resolve,
          onError: reject
        });
      } finally {
        (globalThis as { EventSource?: unknown }).EventSource = orig;
      }
    });
    expect(progresses).toHaveLength(1);
    expect(terminal).toMatchObject({ status: "succeeded" });
  });
});
