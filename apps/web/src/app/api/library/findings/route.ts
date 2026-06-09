import { NextResponse } from "next/server";
import {
  listFindingLibrary,
  upsertFindingLibraryEntry,
  type UpsertFindingLibraryEntryInput
} from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/library/findings  — list reusable finding writeups
// POST /api/library/findings  — create or replace one (id optional)

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const db = getDb();
  const entries = listFindingLibrary(db, { search, category, limit });
  return NextResponse.json({ entries, count: entries.length });
}

export async function POST(request: Request) {
  let body: UpsertFindingLibraryEntryInput;
  try {
    body = (await request.json()) as UpsertFindingLibraryEntryInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.name || !body?.category || !body?.severity) {
    return NextResponse.json({ error: "name, category, and severity are required" }, { status: 400 });
  }
  const db = getDb();
  const entry = upsertFindingLibraryEntry(db, body);
  return NextResponse.json({ entry }, { status: 201 });
}
