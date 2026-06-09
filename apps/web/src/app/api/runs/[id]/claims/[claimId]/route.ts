import { NextResponse } from "next/server";
import {
  groundClaim,
  LLMProviderError,
  providerFromConfig,
  VerricEngineError,
  type ReportClaim,
  type VerricReport
} from "@verric/core";
import { appendReportVersion, getRun, recordClaimEdit } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/runs/[id]/claims/[claimId]
//
// Edit a claim: { text?, evidenceIds?, action?: "accept" | "reject" | "reground" }
//
//   - `text`        — replace the prose. Bumps the report version.
//   - `evidenceIds` — replace the citation set. Bumps the version.
//   - `action`:
//       "accept"   → status = "grounded"
//       "reject"   → status = "flagged"
//       "reground" → call the verifier and apply its verdict
//
// Returns the updated report and the new version number.
//
// Audit log entries are appended to claim_edits for every transition.
// ─────────────────────────────────────────────────────────────────────────

type Ctx = { params: Promise<{ id: string; claimId: string }> };

interface PatchBody {
  text?: string;
  evidenceIds?: string[];
  action?: "accept" | "reject" | "reground";
  editedBy?: string;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id: runId, claimId } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const db = getDb();
  const run = getRun(db, runId);
  if (!run || !run.report) {
    return NextResponse.json({ error: "Run not found or has no report" }, { status: 404 });
  }

  // Locate the claim to edit. We support claims in executiveSummary,
  // keyRecommendations, and inside any finding section.
  const located = locateClaim(run.report, claimId);
  if (!located) {
    return NextResponse.json({ error: `Claim ${claimId} not found` }, { status: 404 });
  }
  const before = JSON.parse(JSON.stringify(located.claim)) as ReportClaim;

  // 1. Apply text + evidence edits in memory.
  let updated: ReportClaim = { ...located.claim };
  if (typeof body.text === "string") updated.text = body.text;
  if (Array.isArray(body.evidenceIds)) {
    const validIds = new Set(run.chunks.map((c) => c.id));
    updated.evidenceIds = body.evidenceIds.filter((id) => validIds.has(id));
    // Edits invalidate the prior verdict — back to needs_review until re-grounded.
    if (updated.evidenceIds.length === 0) updated.status = "needs_review";
  }

  // 2. Apply the action (overrides status if present).
  if (body.action === "accept") {
    updated.status = "grounded";
    updated.groundingNote = undefined;
    updated.confidence = updated.evidenceIds.length >= 2 ? 0.95 : 0.85;
  } else if (body.action === "reject") {
    updated.status = "flagged";
    updated.groundingNote = updated.groundingNote ?? "Verric: rejected by reviewer.";
    updated.confidence = 0.1;
  } else if (body.action === "reground") {
    let provider;
    try {
      provider = providerFromConfig(pickProviderConfig());
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown provider error";
      return NextResponse.json({ error: "Provider not configured", detail }, { status: 500 });
    }
    try {
      const result = await groundClaim({
        claim: updated,
        chunks: run.chunks,
        provider
      });
      updated = result.claim;
      // Record the verdict separately for the audit trail.
      recordClaimEdit(db, {
        runId,
        version: run.report ? ((run as { latestVersion?: number }).latestVersion ?? 1) : 1,
        claimId,
        action: "reground",
        before: { status: before.status, groundingNote: before.groundingNote },
        after: { status: updated.status, groundingNote: updated.groundingNote, verdict: result.verdict },
        editedBy: body.editedBy ?? null
      });
    } catch (err) {
      if (err instanceof VerricEngineError) {
        return NextResponse.json(
          { error: "Engine failure", stage: err.stage, detail: err.message },
          { status: err.stage === "canary_triggered" ? 422 : 502 }
        );
      }
      if (err instanceof LLMProviderError) {
        return NextResponse.json({ error: "Provider call failed", detail: err.message }, { status: 502 });
      }
      throw err;
    }
  }

  // 3. Splice the updated claim back into the report.
  const nextReport = replaceClaim(run.report, claimId, updated);

  // 4. Persist as a new version.
  const newVersion = appendReportVersion(db, {
    runId,
    report: nextReport,
    parentVersion: 1,
    editedBy: body.editedBy ?? null,
    editSummary: summarize(body)
  });

  // 5. Audit log for non-reground edits (reground was already logged above).
  if (body.action !== "reground") {
    if (typeof body.text === "string" && before.text !== updated.text) {
      recordClaimEdit(db, {
        runId,
        version: newVersion,
        claimId,
        action: "edit_text",
        before: { text: before.text },
        after: { text: updated.text },
        editedBy: body.editedBy ?? null
      });
    }
    if (Array.isArray(body.evidenceIds)) {
      recordClaimEdit(db, {
        runId,
        version: newVersion,
        claimId,
        action: "edit_evidence",
        before: { evidenceIds: before.evidenceIds },
        after: { evidenceIds: updated.evidenceIds },
        editedBy: body.editedBy ?? null
      });
    }
    if (body.action === "accept") {
      recordClaimEdit(db, {
        runId,
        version: newVersion,
        claimId,
        action: "accept",
        before: { status: before.status },
        after: { status: updated.status },
        editedBy: body.editedBy ?? null
      });
    } else if (body.action === "reject") {
      recordClaimEdit(db, {
        runId,
        version: newVersion,
        claimId,
        action: "reject",
        before: { status: before.status },
        after: { status: updated.status },
        editedBy: body.editedBy ?? null
      });
    }
  }

  return NextResponse.json({
    runId,
    version: newVersion,
    claim: updated,
    report: nextReport
  });
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

interface ClaimLocation {
  claim: ReportClaim;
}

function locateClaim(report: VerricReport, claimId: string): ClaimLocation | null {
  for (const c of report.executiveSummary) if (c.id === claimId) return { claim: c };
  for (const c of report.keyRecommendations) if (c.id === claimId) return { claim: c };
  for (const f of report.findings) {
    for (const c of f.description) if (c.id === claimId) return { claim: c };
    for (const c of f.impact) if (c.id === claimId) return { claim: c };
    for (const c of f.proofOfConcept) if (c.id === claimId) return { claim: c };
    for (const c of f.remediation) if (c.id === claimId) return { claim: c };
  }
  return null;
}

function replaceClaim(report: VerricReport, claimId: string, replacement: ReportClaim): VerricReport {
  const swap = (list: ReportClaim[]) => list.map((c) => (c.id === claimId ? replacement : c));
  return {
    ...report,
    executiveSummary: swap(report.executiveSummary),
    keyRecommendations: swap(report.keyRecommendations),
    findings: report.findings.map((f) => ({
      ...f,
      description: swap(f.description),
      impact: swap(f.impact),
      proofOfConcept: swap(f.proofOfConcept),
      remediation: swap(f.remediation)
    }))
  };
}

function summarize(body: PatchBody): string {
  const parts: string[] = [];
  if (typeof body.text === "string") parts.push("edited text");
  if (Array.isArray(body.evidenceIds)) parts.push("changed evidence");
  if (body.action === "accept") parts.push("accepted");
  if (body.action === "reject") parts.push("rejected");
  if (body.action === "reground") parts.push("re-grounded");
  return parts.length > 0 ? parts.join(", ") : "edited";
}

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
