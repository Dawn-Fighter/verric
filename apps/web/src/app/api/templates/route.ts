import { NextResponse } from "next/server";
import {
  deleteTemplateRegistryEntry,
  listTemplateRegistry,
  upsertTemplateRegistryEntry,
  type UpsertTemplateInput
} from "@verric/storage";
import { getDb } from "@/lib/db";
// Bootstrap: ensure the built-in pentest + postmortem templates are
// always registered. This is what the marketplace UI lists alongside
// any community templates an operator installs later.
import { pentestTemplate, postmortemTemplate, adrTemplate } from "@verric/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/templates    — list registered templates (built-ins + installed)
// POST /api/templates    — register/install a template
// DELETE /api/templates  — uninstall (?id=...)

function ensureBuiltinsRegistered() {
  const db = getDb();
  upsertTemplateRegistryEntry(db, {
    id: pentestTemplate.id,
    name: pentestTemplate.displayName,
    version: pentestTemplate.id.split("@")[1] ?? "0.1.0",
    description: "Reference pentest report template (built-in).",
    source: "@verric/core"
  });
  upsertTemplateRegistryEntry(db, {
    id: postmortemTemplate.id,
    name: postmortemTemplate.displayName,
    version: postmortemTemplate.id.split("@")[1] ?? "0.1.0",
    description: "Blameless incident postmortem template (built-in).",
    source: "@verric/core"
  });
  upsertTemplateRegistryEntry(db, {
    id: adrTemplate.id,
    name: adrTemplate.displayName,
    version: adrTemplate.id.split("@")[1] ?? "0.1.0",
    description: "Architecture Decision Record template (built-in).",
    source: "@verric/core"
  });
}

export async function GET() {
  ensureBuiltinsRegistered();
  const db = getDb();
  return NextResponse.json({ templates: listTemplateRegistry(db) });
}

export async function POST(request: Request) {
  let body: UpsertTemplateInput;
  try {
    body = (await request.json()) as UpsertTemplateInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body?.id || !body?.name || !body?.version) {
    return NextResponse.json({ error: "id, name, and version are required" }, { status: 400 });
  }
  const db = getDb();
  const template = upsertTemplateRegistryEntry(db, body);
  return NextResponse.json({ template }, { status: 201 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  if (id === pentestTemplate.id || id === postmortemTemplate.id || id === adrTemplate.id) {
    return NextResponse.json(
      { error: "Built-in templates can be disabled but not deleted" },
      { status: 400 }
    );
  }
  const db = getDb();
  const ok = deleteTemplateRegistryEntry(db, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
