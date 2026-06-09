// Verric persistence schema — vanilla SQL, applied idempotently at boot.
//
// Why no Drizzle/Prisma? We have ~6 tables and a handful of queries. The
// indirection cost outweighs the type-safety benefit at this scale, and
// node:sqlite ships in core Node so there's nothing to install. When the
// schema grows or we need Postgres, we'll layer Drizzle on top —
// migrations live here, repository helpers in repository.ts.

import type { Database } from "./sqlite";

/** Bumped whenever a migration is added. Stored in the meta table. */
export const SCHEMA_VERSION = 4;

const STATEMENTS: string[] = [
  // Meta — for tracking schema version. Keep keys lower-snake_case.
  `CREATE TABLE IF NOT EXISTS verric_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  // Projects (engagements). The full ProjectDetails goes in details_json
  // so we don't need to migrate the table every time we add a field.
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     client_name TEXT NOT NULL,
     classification TEXT NOT NULL,
     details_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,

  // Runs — one per "Run Verric Review" attempt. Includes failed runs so
  // operators can see what went wrong (no API key, canary triggered, etc).
  // Schema v2: added 'queued' and 'running' to the status check so async
  // runs can be tracked from creation through completion.
  `CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     template TEXT NOT NULL,
     provider_id TEXT NOT NULL,
     model TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canary_triggered')),
     failure_stage TEXT,
     failure_message TEXT,
     duration_ms INTEGER,
     canary_triggered INTEGER NOT NULL DEFAULT 0,
     verifier_failed INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     completed_at INTEGER,
     FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at)`,

  // Evidence chunks (snapshot per run, so receipts stay verifiable).
  `CREATE TABLE IF NOT EXISTS chunks (
     run_id TEXT NOT NULL,
     id TEXT NOT NULL,
     artifact_id TEXT NOT NULL,
     artifact_name TEXT NOT NULL,
     line_start INTEGER NOT NULL,
     line_end INTEGER NOT NULL,
     text TEXT NOT NULL,
     PRIMARY KEY (run_id, id),
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,

  // Artifacts (top-level files). content lives inline for now; later
  // moves to object storage with content_url replacing content.
  `CREATE TABLE IF NOT EXISTS artifacts (
     run_id TEXT NOT NULL,
     id TEXT NOT NULL,
     name TEXT NOT NULL,
     kind TEXT NOT NULL,
     type TEXT NOT NULL,
     size INTEGER NOT NULL,
     content TEXT,
     preview TEXT,
     PRIMARY KEY (run_id, id),
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,

  // Reports — versioned per run. report_json is the canonical document;
  // verdicts_json is the verifier output (may be null if verifier was off
  // or failed); receipt_json is the signed receipt.
  //
  // Schema v3: this row holds the LATEST version. Historical versions
  // live in report_versions. A run starts with one row here at version 1
  // (the original engine output) and a matching row in report_versions.
  `CREATE TABLE IF NOT EXISTS reports (
     run_id TEXT PRIMARY KEY,
     report_json TEXT NOT NULL,
     verdicts_json TEXT,
     receipt_json TEXT NOT NULL,
     latest_version INTEGER NOT NULL DEFAULT 1,
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,

  // Run events — append-only progress log per run. Lets the UI replay
  // events for a run that was already in flight when the page connected,
  // and persists the full trace for ops/debugging.
  `CREATE TABLE IF NOT EXISTS run_events (
     run_id TEXT NOT NULL,
     sequence INTEGER NOT NULL,
     stage TEXT NOT NULL,
     message TEXT NOT NULL,
     elapsed_ms INTEGER NOT NULL,
     data_json TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (run_id, sequence),
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_seq ON run_events(run_id, sequence)`,

  // Schema v3 — versioned report snapshots + audit log for the editor.
  //
  // Every claim edit / accept / reject / re-ground writes a new
  // report_versions row. The reports row tracks the latest_version.
  // The diff endpoint reads two rows from here.
  `CREATE TABLE IF NOT EXISTS report_versions (
     run_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     report_json TEXT NOT NULL,
     parent_version INTEGER,
     edited_by TEXT,
     edit_summary TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (run_id, version),
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_report_versions_run ON report_versions(run_id, version DESC)`,

  // Append-only audit log of per-claim edits. Captures the exact before
  // and after JSON so reviewers can defend the trail later.
  `CREATE TABLE IF NOT EXISTS claim_edits (
     run_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     sequence INTEGER NOT NULL,
     claim_id TEXT NOT NULL,
     action TEXT NOT NULL CHECK (action IN ('edit_text','edit_evidence','accept','reject','reground','flag','unflag')),
     before_json TEXT,
     after_json TEXT,
     edited_by TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (run_id, version, sequence),
     FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS idx_claim_edits_run ON claim_edits(run_id, claim_id, created_at DESC)`,

  // Schema v4 — finding library (reusable writeups) + branded templates.
  //
  // Finding library: pre-vetted finding writeups testers can pull into a
  // new report (description / impact / remediation prose, references,
  // default severity). Library entries are global to a Verric install
  // (single-team self-host); a project filter can scope picks per-engagement.
  `CREATE TABLE IF NOT EXISTS finding_library (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     severity TEXT NOT NULL,
     default_cvss_vector TEXT,
     description_text TEXT,
     impact_text TEXT,
     remediation_text TEXT,
     references_json TEXT,
     tags_json TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_finding_library_name ON finding_library(name)`,
  `CREATE INDEX IF NOT EXISTS idx_finding_library_category ON finding_library(category)`,

  // Branded report templates — per-firm logo + colors + chrome that the
  // exporters apply on top of the standard report layout.
  `CREATE TABLE IF NOT EXISTS report_branding (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     logo_data_url TEXT,
     primary_color TEXT,
     secondary_color TEXT,
     accent_color TEXT,
     footer_text TEXT,
     cover_subtitle TEXT,
     custom_css TEXT,
     is_default INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_report_branding_default ON report_branding(is_default)`,

  // Template marketplace registry — installed report templates with
  // their metadata (id, version, source URL/path). The actual template
  // implementations are JS modules registered at runtime; this table
  // tracks WHICH ones the operator has "installed" / approved.
  `CREATE TABLE IF NOT EXISTS template_registry (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     version TEXT NOT NULL,
     description TEXT,
     source TEXT,
     installed_at INTEGER NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1
   )`
];

/**
 * Apply the schema. Idempotent — safe to call on every boot. Each
 * statement is `CREATE TABLE/INDEX IF NOT EXISTS`, so we deliberately
 * don't wrap them in a single transaction: `db.exec("BEGIN")` interacts
 * badly with SQLite's implicit-transaction handling for some DDL when
 * the database is already partially populated, and that complexity buys
 * us nothing for an idempotent migration.
 *
 * v1 → v2 in-place upgrades:
 *   - runs.status CHECK constraint now includes 'queued' and 'running'.
 *     Existing v1 databases need an ALTER. We handle that by reading the
 *     old schema_version, and if it's < 2, rewriting the runs table.
 */
export function migrate(db: Database): void {
  // Ensure the meta table exists before we try to read schema_version.
  db.exec(`CREATE TABLE IF NOT EXISTS verric_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`);
  const previous = readSchemaVersion(db);
  if (previous !== null && previous < 2 && hasV1RunsTable(db)) {
    upgradeRunsTableToV2(db);
  }
  if (previous !== null && previous < 3) {
    upgradeReportsTableToV3(db);
  }

  for (const stmt of STATEMENTS) {
    db.exec(stmt);
  }

  // After v3's CREATE TABLE statements, seed version 1 of every existing
  // report into report_versions so the diff/history endpoints have a
  // baseline to start from.
  if (previous !== null && previous < 3) {
    seedReportVersionsFromExistingReports(db);
  }

  db.prepare(
    `INSERT INTO verric_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(String(SCHEMA_VERSION));
}

function hasV1RunsTable(db: Database): boolean {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='runs'`).get() as
    | { sql?: string }
    | undefined;
  // v1 had only succeeded/failed/canary_triggered in its CHECK constraint.
  return !!row?.sql && !row.sql.includes("'queued'");
}

/** v1 runs table doesn't allow 'queued'/'running'. Rebuild it. */
function upgradeRunsTableToV2(db: Database): void {
  db.exec("ALTER TABLE runs RENAME TO runs_v1");
  db.exec(`CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     template TEXT NOT NULL,
     provider_id TEXT NOT NULL,
     model TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canary_triggered')),
     failure_stage TEXT,
     failure_message TEXT,
     duration_ms INTEGER,
     canary_triggered INTEGER NOT NULL DEFAULT 0,
     verifier_failed INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     completed_at INTEGER,
     FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
   )`);
  db.exec(`INSERT INTO runs (
     id, project_id, template, provider_id, model, status, failure_stage,
     failure_message, duration_ms, canary_triggered, verifier_failed, created_at
   ) SELECT
     id, project_id, template, provider_id, model, status, failure_stage,
     failure_message, duration_ms, canary_triggered, verifier_failed, created_at
   FROM runs_v1`);
  db.exec("DROP TABLE runs_v1");
}

/** v2 reports table lacks the latest_version column. Add it in-place. */
function upgradeReportsTableToV3(db: Database): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='reports'`).get() as
    | { sql?: string }
    | undefined;
  if (!row?.sql) return; // no v2 reports table existed
  if (row.sql.includes("latest_version")) return; // already v3-shaped
  db.exec(`ALTER TABLE reports ADD COLUMN latest_version INTEGER NOT NULL DEFAULT 1`);
}

/**
 * After a v2→v3 migration, copy each existing reports row into
 * report_versions as version 1 so the editor has a starting baseline.
 */
function seedReportVersionsFromExistingReports(db: Database): void {
  const rows = db.prepare(`SELECT run_id, report_json FROM reports`).all() as Array<{
    run_id: string;
    report_json: string;
  }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO report_versions
       (run_id, version, report_json, parent_version, edited_by, edit_summary, created_at)
     VALUES (?, 1, ?, NULL, NULL, 'Initial engine output', ?)`
  );
  const now = Date.now();
  for (const r of rows) {
    insert.run(r.run_id, r.report_json, now);
  }
}

export function readSchemaVersion(db: Database): number | null {
  const row = db.prepare("SELECT value FROM verric_meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : null;
}
