import { NextResponse } from "next/server";
import { deleteBranding, getBranding, upsertBranding, type UpsertBrandingInput } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const branding = getBranding(db, id);
  if (!branding) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ branding });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: UpsertBrandingInput;
  try {
    body = (await request.json()) as UpsertBrandingInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const db = getDb();
  const branding = upsertBranding(db, { ...body, id });
  return NextResponse.json({ branding });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const db = getDb();
  const ok = deleteBranding(db, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
