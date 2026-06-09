import { NextResponse } from "next/server";
import { listBranding, upsertBranding, type UpsertBrandingInput } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/branding  — list all branded templates
// POST /api/branding  — create or update one

export async function GET() {
  const db = getDb();
  return NextResponse.json({ branding: listBranding(db) });
}

export async function POST(request: Request) {
  let body: UpsertBrandingInput;
  try {
    body = (await request.json()) as UpsertBrandingInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const db = getDb();
  const branding = upsertBranding(db, body);
  return NextResponse.json({ branding }, { status: 201 });
}
