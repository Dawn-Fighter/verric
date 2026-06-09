import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/runs/[id]    — full run with report, evidence, receipt
// DELETE /api/runs/[id] — cascade-delete the run
// ─────────────────────────────────────────────────────────────────────────

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const run = getRun(db, id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const ok = deleteRun(db, id);
  if (!ok) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
