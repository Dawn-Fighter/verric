// Verric MCP server — exposes runs / reports / evidence / receipts as
// Model Context Protocol resources and tools. Coding agents
// (Cursor, Claude Code, opencode, etc.) can query the server to fetch
// grounded report context as a tool, instead of hallucinating about
// what's in the team's report history.
//
// Transport: stdio (the default for `npx`-style MCP servers). Reads the
// same SQLite database the web app and CLI write to.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  closeDatabase,
  getRun,
  listRunEvents,
  listRuns,
  migrate,
  openDatabase,
  type Database
} from "@verric/storage";
import { verifyReceipt } from "@verric/core";

export interface VerricMcpServerOptions {
  /** Path to the SQLite file. Defaults to VERRIC_DB_PATH or ./verric.db. */
  dbPath?: string;
}

export interface VerricMcpServer {
  server: Server;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createVerricMcpServer(options: VerricMcpServerOptions = {}): VerricMcpServer {
  const dbPath = options.dbPath ?? process.env.VERRIC_DB_PATH ?? "verric.db";
  let db: Database | null = null;

  const server = new Server(
    {
      name: "verric",
      version: "0.1.0"
    },
    {
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false }
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────
  // Resources — agents can read these directly via MCP read_resource
  // ─────────────────────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!db) throw new Error("Server not started");
    const runs = listRuns(db, { limit: 100 });
    return {
      resources: [
        {
          uri: "verric://runs",
          mimeType: "application/json",
          name: "Recent runs (summary)",
          description: "Last 100 Verric runs with status and metadata."
        },
        ...runs.map((r) => ({
          uri: `verric://runs/${r.id}`,
          mimeType: "application/json",
          name: `Run ${r.id.slice(0, 8)} — ${r.template} [${r.status}]`,
          description:
            r.status === "succeeded"
              ? `Run completed at ${new Date(r.completedAt ?? r.createdAt).toISOString()}`
              : `Run ${r.status}${r.failureStage ? ` (${r.failureStage})` : ""}`
        }))
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (!db) throw new Error("Server not started");
    const uri = req.params.uri;
    if (uri === "verric://runs") {
      const runs = listRuns(db, { limit: 100 });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(runs, null, 2)
          }
        ]
      };
    }
    const m = uri.match(/^verric:\/\/runs\/([a-f0-9-]+)$/i);
    if (m) {
      const run = getRun(db, m[1]);
      if (!run) throw new Error(`Unknown run ${m[1]}`);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(run, null, 2)
          }
        ]
      };
    }
    throw new Error(`Unsupported resource URI: ${uri}`);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Tools — actions agents can call
  // ─────────────────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "verric_list_runs",
        description:
          "List recent Verric runs in reverse chronological order. Each entry includes status, provider, template, and timing. Use this to discover what reports exist before fetching one.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Filter to a single project id." },
            limit: { type: "number", description: "Max results (1-200). Default 50." }
          }
        }
      },
      {
        name: "verric_get_run",
        description:
          "Fetch a complete run: project metadata, evidence chunks, artifacts, the validated report (if succeeded), grounding verdicts, and the cryptographic receipt. The report's claims cite evidence-chunk IDs that are also returned here, so agents can verify provenance themselves.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string", description: "Run id (UUID)." }
          },
          required: ["runId"]
        }
      },
      {
        name: "verric_list_run_events",
        description:
          "Return the full progress-event log for a run: started → drafting → drafted → parsing → validated → verified → finalized (or the failure stage). Useful for understanding why a run took as long as it did or where it failed.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string", description: "Run id (UUID)." },
            since: {
              type: "number",
              description: "Sequence number to fetch events newer than (exclusive). Default -1 = all."
            }
          },
          required: ["runId"]
        }
      },
      {
        name: "verric_verify_receipt",
        description:
          "Independently verify a Verric receipt against its run's evidence + report. Returns ok=true if the HMAC signature, evidence digest, and report digest all match. The signing key is required.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string", description: "Run id whose receipt to verify." },
            signingKey: {
              type: "string",
              description: "HMAC signing key the receipt was signed with."
            }
          },
          required: ["runId", "signingKey"]
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!db) throw new Error("Server not started");
    const { name, arguments: args = {} } = req.params;
    try {
      if (name === "verric_list_runs") {
        const a = args as { projectId?: string; limit?: number };
        const runs = listRuns(db, { projectId: a.projectId, limit: a.limit });
        return {
          content: [{ type: "text", text: JSON.stringify({ runs, count: runs.length }, null, 2) }]
        };
      }
      if (name === "verric_get_run") {
        const a = args as { runId: string };
        const run = getRun(db, a.runId);
        if (!run) {
          return {
            isError: true,
            content: [{ type: "text", text: `Run ${a.runId} not found` }]
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }] };
      }
      if (name === "verric_list_run_events") {
        const a = args as { runId: string; since?: number };
        const events = listRunEvents(db, a.runId, a.since ?? -1);
        return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
      }
      if (name === "verric_verify_receipt") {
        const a = args as { runId: string; signingKey: string };
        const run = getRun(db, a.runId);
        if (!run) {
          return {
            isError: true,
            content: [{ type: "text", text: `Run ${a.runId} not found` }]
          };
        }
        if (!run.receipt || !run.report) {
          return {
            isError: true,
            content: [{ type: "text", text: `Run ${a.runId} has no receipt (status=${run.status})` }]
          };
        }
        const result = verifyReceipt({
          receipt: run.receipt,
          signingKey: a.signingKey,
          evidence: run.chunks,
          report: run.report,
          verdicts: run.verdicts ?? undefined
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: result.ok,
                  mismatches: result.mismatches,
                  signature: run.receipt.signature,
                  template: run.receipt.template,
                  model: run.receipt.model
                },
                null,
                2
              )
            }
          ]
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }]
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Tool error: ${(err as Error).message}` }]
      };
    }
  });

  return {
    server,
    async start() {
      db = openDatabase({ path: dbPath });
      migrate(db);
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
    async stop() {
      if (db) {
        closeDatabase(db);
        db = null;
      }
      await server.close();
    }
  };
}
