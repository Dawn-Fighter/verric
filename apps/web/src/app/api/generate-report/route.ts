import { NextResponse } from "next/server";
import {
  type EvidenceArtifact,
  type EvidenceChunk,
  type ProjectDetails,
  LLMProviderError,
  providerFromConfig
} from "@verric/core";
import { createPendingRun, findOrCreateProject } from "@verric/storage";
import { getDb } from "@/lib/db";
import { processRun } from "@/lib/worker";

export const runtime = "nodejs";
// Async pipeline: the response returns immediately and the worker keeps
// running. Tell Next not to short-circuit on cold-start delays.
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// POST /api/generate-report
//
// Trust contract: real provider or honest failure. Never invents results.
//
//   1. Pick a provider from env (openai | anthropic | ollama). If the
//      config is invalid, return 500 immediately — no run is recorded.
//   2. Insert a queued run row + evidence snapshot. Return 202 with
//      { runId, statusUrl, streamUrl } so the client can subscribe.
//   3. Fire the worker in the background. The route response is already
//      sent by the time the worker hits the LLM.
//
// Subscribe to /api/runs/[id]/stream for live progress events, or poll
// /api/runs/[id] for the final state.
// ─────────────────────────────────────────────────────────────────────────

function pickProviderConfig() {
  const provider = (process.env.VERRIC_PROVIDER || "").toLowerCase() as
    | "openai"
    | "anthropic"
    | "ollama"
    | "";
  let apiKey: string | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;
  if (provider === "anthropic") {
    apiKey = process.env.ANTHROPIC_API_KEY;
    model = process.env.ANTHROPIC_MODEL;
    baseUrl = process.env.ANTHROPIC_BASE_URL;
  } else if (provider === "ollama") {
    model = process.env.OLLAMA_MODEL;
    baseUrl = process.env.OLLAMA_BASE_URL;
  } else if (provider === "openai") {
    apiKey = process.env.OPENAI_API_KEY;
    model = process.env.OPENAI_MODEL;
    baseUrl = process.env.OPENAI_BASE_URL;
  } else {
    if (process.env.OPENAI_API_KEY) {
      apiKey = process.env.OPENAI_API_KEY;
      model = process.env.OPENAI_MODEL;
    } else {
      model = process.env.OLLAMA_MODEL;
      baseUrl = process.env.OLLAMA_BASE_URL;
    }
  }
  return {
    provider: provider || (apiKey ? "openai" : "ollama"),
    apiKey,
    model,
    baseUrl
  } as const;
}

export async function POST(request: Request) {
  let body: {
    project?: ProjectDetails;
    chunks?: EvidenceChunk[];
    artifacts?: EvidenceArtifact[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const project = body.project;
  const chunks = (body.chunks || []).slice(0, 180);
  const artifacts = (body.artifacts || []).slice(0, 10);

  if (!project) {
    return NextResponse.json({ error: "Missing project details." }, { status: 400 });
  }
  if (chunks.length === 0) {
    return NextResponse.json({ error: "No evidence chunks provided." }, { status: 400 });
  }

  // Provider config check (synchronous, before we record anything).
  let provider;
  try {
    const cfg = pickProviderConfig();
    provider = providerFromConfig(cfg);
  } catch (err) {
    const detail =
      err instanceof LLMProviderError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Unknown provider error";
    return NextResponse.json(
      {
        error: "Provider not configured",
        detail,
        hint: "Set VERRIC_PROVIDER (openai | anthropic | ollama) and the matching API key, or run a local Ollama at OLLAMA_BASE_URL."
      },
      { status: 500 }
    );
  }

  const db = getDb();
  const projectRow = findOrCreateProject(db, project);
  const template = "pentest@0.1.0";
  const signingKey = process.env.VERRIC_SIGNING_KEY || "verric-unsigned";

  let runId: string;
  try {
    runId = createPendingRun(db, {
      projectId: projectRow.id,
      template,
      providerId: provider.id,
      model: provider.model,
      chunks,
      artifacts
    });
  } catch (err) {
    console.error("createPendingRun failed:", err);
    return NextResponse.json(
      { error: "Failed to enqueue run", detail: (err as Error).message },
      { status: 500 }
    );
  }

  // Fire the worker. We deliberately do NOT await — the response goes
  // back immediately and the worker drives the engine to completion in
  // the background. Errors inside processRun are caught + recorded;
  // .catch here is a belt-and-braces guard for unforeseen rejections.
  void processRun(db, { runId, provider, signingKey, template }).catch((err) => {
    console.error(`processRun(${runId}) crashed:`, err);
  });

  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  return NextResponse.json(
    {
      runId,
      statusUrl: `${base}/api/runs/${runId}`,
      streamUrl: `${base}/api/runs/${runId}/stream`,
      mode: provider.id
    },
    { status: 202 }
  );
}
