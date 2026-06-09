import { NextResponse } from "next/server";
import {
  deleteFindingLibraryEntry,
  getFindingLibraryEntry,
  upsertFindingLibraryEntry,
  type UpsertFindingLibraryEntryInput
} from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const entry = getFindingLibraryEntry(db, id);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: UpsertFindingLibraryEntryInput;
  try {
    body = (await request.json()) as UpsertFindingLibraryEntryInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const db = getDb();
  const entry = upsertFindingLibraryEntry(db, { ...body, id });
  return NextResponse.json({ entry });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const ok = deleteFindingLibraryEntry(db, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
