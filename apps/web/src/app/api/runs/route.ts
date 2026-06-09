import { NextResponse } from "next/server";
import { listRuns } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/runs?projectId=&limit=&offset=
// Lists run metadata in reverse chronological order. The full report +
// receipt are NOT included — fetch them via /api/runs/[id].
// ─────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || undefined;
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100000);

  const db = getDb();
  const runs = listRuns(db, { projectId, limit, offset });
  return NextResponse.json({ runs, count: runs.length });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
