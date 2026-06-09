import { NextResponse } from "next/server";
import { readSchemaVersion, SCHEMA_VERSION } from "@verric/storage";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/health
//
// Liveness + schema sanity. Reports DB connectivity and the migration
// version. Useful for Kubernetes/Docker healthchecks and for
// answering "is my self-host install healthy?"
// ─────────────────────────────────────────────────────────────────────────

export async function GET() {
  const startedAt = Date.now();
  try {
    const db = getDb();
    const version = readSchemaVersion(db);
    const ok = version === SCHEMA_VERSION;
    return NextResponse.json(
      {
        status: ok ? "ok" : "degraded",
        schemaVersion: version,
        expectedSchemaVersion: SCHEMA_VERSION,
        dbPath: process.env.VERRIC_DB_PATH || "verric.db",
        provider: process.env.VERRIC_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "ollama"),
        elapsedMs: Date.now() - startedAt
      },
      { status: ok ? 200 : 503 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt
      },
      { status: 503 }
    );
  }
}
