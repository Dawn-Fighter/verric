import { NextResponse } from "next/server";
import { listReportVersions } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/runs/[id]/versions — list every report version for a run
// (most-recent-first), each with its parent + summary + timestamps.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const versions = listReportVersions(db, id);
  // Strip the full report_json from the list response (way too large
  // for browsing). The UI calls /diff or /versions/{n} for the body.
  const summary = versions.map(({ report: _report, ...rest }) => rest);
  return NextResponse.json({ versions: summary, count: summary.length });
}
