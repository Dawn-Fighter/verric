import { NextResponse } from "next/server";
import type { ReportClaim, VerricReport } from "@verric/core";
import { getReportVersion } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runs/[id]/diff?from=N&to=M
//
// Returns a claim-level diff between two report versions:
//   - added:    claim ids in `to` but not in `from`
//   - removed:  claim ids in `from` but not in `to`
//   - modified: claim ids whose text, evidenceIds, or status changed
// Plus the before/after for each modified claim so the UI can highlight.

type Ctx = { params: Promise<{ id: string }> };

interface ClaimDiff {
  claimId: string;
  before: ReportClaim;
  after: ReportClaim;
  changed: { text: boolean; evidenceIds: boolean; status: boolean };
}

export async function GET(request: Request, ctx: Ctx) {
  const { id: runId } = await ctx.params;
  const url = new URL(request.url);
  const fromN = Number.parseInt(url.searchParams.get("from") ?? "1", 10);
  const toN = Number.parseInt(url.searchParams.get("to") ?? "999", 10);

  const db = getDb();
  const fromVer = getReportVersion(db, runId, fromN);
  const toVer = getReportVersion(db, runId, toN);
  if (!fromVer || !toVer) {
    return NextResponse.json(
      { error: `Versions ${fromN}/${toN} not found for run ${runId}` },
      { status: 404 }
    );
  }

  const fromMap = collectClaims(fromVer.report);
  const toMap = collectClaims(toVer.report);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: ClaimDiff[] = [];

  for (const id of Array.from(toMap.keys())) {
    if (!fromMap.has(id)) added.push(id);
  }
  for (const [id, before] of Array.from(fromMap.entries())) {
    const after = toMap.get(id);
    if (!after) {
      removed.push(id);
      continue;
    }
    const changed = {
      text: before.text !== after.text,
      evidenceIds:
        before.evidenceIds.length !== after.evidenceIds.length ||
        !before.evidenceIds.every((e: string, i: number) => e === after.evidenceIds[i]),
      status: before.status !== after.status
    };
    if (changed.text || changed.evidenceIds || changed.status) {
      modified.push({ claimId: id, before, after, changed });
    }
  }

  return NextResponse.json({
    runId,
    from: { version: fromN, createdAt: fromVer.createdAt },
    to: { version: toN, createdAt: toVer.createdAt },
    added,
    removed,
    modified
  });
}

function collectClaims(report: VerricReport): Map<string, ReportClaim> {
  const out = new Map<string, ReportClaim>();
  for (const c of report.executiveSummary) out.set(c.id, c);
  for (const c of report.keyRecommendations) out.set(c.id, c);
  for (const f of report.findings) {
    for (const c of f.description) out.set(c.id, c);
    for (const c of f.impact) out.set(c.id, c);
    for (const c of f.proofOfConcept) out.set(c.id, c);
    for (const c of f.remediation) out.set(c.id, c);
  }
  return out;
}
