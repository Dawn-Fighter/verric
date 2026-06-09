// Repository helpers — typed CRUD over the raw SQL schema.
//
// Keeping them as small free functions (not a class) so that route
// handlers, the upcoming CLI, and the REST API can all import the
// pieces they need without dragging in a connection-management layer.

import { randomUUID } from "node:crypto";
import type {
  EvidenceArtifact,
  EvidenceChunk,
  ProjectDetails,
  Receipt,
  RunProgressEvent,
  VerricReport,
  GroundingVerdict
} from "@verric/core";
import type { Database } from "./sqlite";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface ProjectRow {
  id: string;
  name: string;
  clientName: string;
  classification: string;
  details: ProjectDetails;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canary_triggered";

export interface RunRow {
  id: string;
  projectId: string;
  template: string;
  providerId: string;
  model: string;
  status: RunStatus;
  failureStage: string | null;
  failureMessage: string | null;
  durationMs: number | null;
  canaryTriggered: boolean;
  verifierFailed: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface RunWithReport extends RunRow {
  project: ProjectDetails;
  chunks: EvidenceChunk[];
  artifacts: EvidenceArtifact[];
  report: VerricReport | null;
  verdicts: GroundingVerdict[] | null;
  receipt: Receipt | null;
}

/** A persisted RunProgressEvent with its sequence number + DB-side timestamp. */
export interface RunEventRow {
  runId: string;
  sequence: number;
  stage: string;
  message: string;
  elapsedMs: number;
  data: Record<string, unknown> | null;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  id?: string;
  details: ProjectDetails;
}

export function createProject(db: Database, input: CreateProjectInput): ProjectRow {
  const id = input.id ?? randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, client_name, classification, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.details.projectName,
    input.details.clientName,
    input.details.classification,
    JSON.stringify(input.details),
    now,
    now
  );
  return {
    id,
    name: input.details.projectName,
    clientName: input.details.clientName,
    classification: input.details.classification,
    details: input.details,
    createdAt: now,
    updatedAt: now
  };
}

export function getProject(db: Database, id: string): ProjectRow | null {
  const row = db
    .prepare(
      `SELECT id, name, client_name AS clientName, classification, details_json AS detailsJson,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        name: string;
        clientName: string;
        classification: string;
        detailsJson: string;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    clientName: row.clientName,
    classification: row.classification,
    details: JSON.parse(row.detailsJson) as ProjectDetails,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/**
 * Find an existing project by clientName + projectName, or create a new
 * one. Useful for the web app's "submit and persist" flow where we don't
 * want to multiply project rows for every regeneration of the same brief.
 */
export function findOrCreateProject(db: Database, details: ProjectDetails): ProjectRow {
  const existing = db
    .prepare(
      `SELECT id, name, client_name AS clientName, classification, details_json AS detailsJson,
              created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE client_name = ? AND name = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(details.clientName, details.projectName) as
    | {
        id: string;
        name: string;
        clientName: string;
        classification: string;
        detailsJson: string;
        createdAt: number;
        updatedAt: number;
      }
    | undefined;
  if (existing) {
    // Touch the updated_at and refresh details_json in case the brief changed.
    const now = Date.now();
    db.prepare(`UPDATE projects SET details_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(details),
      now,
      existing.id
    );
    return {
      id: existing.id,
      name: existing.name,
      clientName: existing.clientName,
      classification: existing.classification,
      details,
      createdAt: existing.createdAt,
      updatedAt: now
    };
  }
  return createProject(db, { details });
}

// ─────────────────────────────────────────────────────────────────────────
// Runs — synchronous one-shot record (legacy; kept for tests + simple paths)
// ─────────────────────────────────────────────────────────────────────────

export interface RecordRunInput {
  projectId: string;
  template: string;
  providerId: string;
  model: string;
  status: RunStatus;
  failureStage?: string | null;
  failureMessage?: string | null;
  durationMs?: number | null;
  canaryTriggered?: boolean;
  verifierFailed?: boolean;
  chunks: EvidenceChunk[];
  artifacts: EvidenceArtifact[];
  report?: VerricReport | null;
  verdicts?: GroundingVerdict[] | null;
  receipt?: Receipt | null;
}

/**
 * Record a complete run in a single transaction: the run row, the
 * evidence snapshot (chunks + artifacts) so receipts stay verifiable
 * forever, and the report/receipt if the run succeeded.
 *
 * For the async pipeline (queue + worker + SSE), prefer the granular
 * helpers below: createPendingRun → markRunRunning → completeRunSuccess.
 *
 * Returns the run id.
 */
export function recordRun(db: Database, input: RecordRunInput): string {
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    const startedAt = input.status === "queued" ? null : now;
    const completedAt =
      input.status === "succeeded" || input.status === "failed" || input.status === "canary_triggered"
        ? now
        : null;
    db.prepare(
      `INSERT INTO runs (
         id, project_id, template, provider_id, model, status, failure_stage,
         failure_message, duration_ms, canary_triggered, verifier_failed,
         created_at, started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.projectId,
      input.template,
      input.providerId,
      input.model,
      input.status,
      input.failureStage ?? null,
      input.failureMessage ?? null,
      input.durationMs ?? null,
      input.canaryTriggered ? 1 : 0,
      input.verifierFailed ? 1 : 0,
      now,
      startedAt,
      completedAt
    );

    const insertChunk = db.prepare(
      `INSERT INTO chunks (run_id, id, artifact_id, artifact_name, line_start, line_end, text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of input.chunks) {
      insertChunk.run(id, c.id, c.artifactId, c.artifactName, c.lineStart, c.lineEnd, c.text);
    }

    const insertArtifact = db.prepare(
      `INSERT INTO artifacts (run_id, id, name, kind, type, size, content, preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of input.artifacts) {
      insertArtifact.run(id, a.id, a.name, a.kind, a.type, a.size, a.content ?? null, a.preview ?? null);
    }

    if (input.report && input.receipt) {
      const reportJson = JSON.stringify(input.report);
      db.prepare(
        `INSERT INTO reports (run_id, report_json, verdicts_json, receipt_json, latest_version)
         VALUES (?, ?, ?, ?, 1)`
      ).run(
        id,
        reportJson,
        input.verdicts ? JSON.stringify(input.verdicts) : null,
        JSON.stringify(input.receipt)
      );
      // Seed report_versions v1 so the editor / diff endpoints have a baseline.
      db.prepare(
        `INSERT INTO report_versions
           (run_id, version, report_json, parent_version, edited_by, edit_summary, created_at)
         VALUES (?, 1, ?, NULL, NULL, 'Initial engine output', ?)`
      ).run(id, reportJson, now);
    }

    db.exec("COMMIT");
    return id;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Async pipeline — queue + status transitions + run events
// ─────────────────────────────────────────────────────────────────────────

export interface CreatePendingRunInput {
  projectId: string;
  template: string;
  /** Initial provider id; the actual model used may be filled in once the run starts. */
  providerId: string;
  model: string;
  chunks: EvidenceChunk[];
  artifacts: EvidenceArtifact[];
}

/**
 * Insert a run row in 'queued' state along with its evidence snapshot.
 * The HTTP handler calls this and then fires off a background worker
 * that picks up the run by id and processes it.
 */
export function createPendingRun(db: Database, input: CreatePendingRunInput): string {
  const id = randomUUID();
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO runs (
         id, project_id, template, provider_id, model, status, failure_stage,
         failure_message, duration_ms, canary_triggered, verifier_failed,
         created_at, started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, NULL, 0, 0, ?, NULL, NULL)`
    ).run(id, input.projectId, input.template, input.providerId, input.model, now);

    const insertChunk = db.prepare(
      `INSERT INTO chunks (run_id, id, artifact_id, artifact_name, line_start, line_end, text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of input.chunks) {
      insertChunk.run(id, c.id, c.artifactId, c.artifactName, c.lineStart, c.lineEnd, c.text);
    }
    const insertArtifact = db.prepare(
      `INSERT INTO artifacts (run_id, id, name, kind, type, size, content, preview)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const a of input.artifacts) {
      insertArtifact.run(id, a.id, a.name, a.kind, a.type, a.size, a.content ?? null, a.preview ?? null);
    }
    db.exec("COMMIT");
    return id;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Atomically transition a queued run to running. Returns true if the
 * transition succeeded — false if another worker beat us to it (or the
 * run is already in a terminal state). Safe to call from multiple
 * workers; SQLite serializes the UPDATE.
 */
export function markRunRunning(db: Database, runId: string): boolean {
  const now = Date.now();
  const result = db
    .prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'`)
    .run(now, runId);
  return result.changes === 1;
}

export interface CompleteRunSuccessInput {
  runId: string;
  durationMs: number;
  canaryTriggered?: boolean;
  verifierFailed?: boolean;
  /** May be updated from the queued placeholder if the provider returned a more specific model id. */
  model?: string;
  report: VerricReport;
  verdicts?: GroundingVerdict[] | null;
  receipt: Receipt;
}

export function completeRunSuccess(db: Database, input: CompleteRunSuccessInput): void {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE runs
         SET status = 'succeeded',
             duration_ms = ?,
             canary_triggered = ?,
             verifier_failed = ?,
             model = COALESCE(?, model),
             completed_at = ?
       WHERE id = ?`
    ).run(
      input.durationMs,
      input.canaryTriggered ? 1 : 0,
      input.verifierFailed ? 1 : 0,
      input.model ?? null,
      now,
      input.runId
    );
    const reportJson = JSON.stringify(input.report);
    db.prepare(
      `INSERT INTO reports (run_id, report_json, verdicts_json, receipt_json, latest_version)
         VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (run_id) DO UPDATE SET
         report_json = excluded.report_json,
         verdicts_json = excluded.verdicts_json,
         receipt_json = excluded.receipt_json,
         latest_version = 1`
    ).run(
      input.runId,
      reportJson,
      input.verdicts ? JSON.stringify(input.verdicts) : null,
      JSON.stringify(input.receipt)
    );
    // Seed report_versions v1 — the engine output is always version 1.
    db.prepare(
      `INSERT OR REPLACE INTO report_versions
         (run_id, version, report_json, parent_version, edited_by, edit_summary, created_at)
       VALUES (?, 1, ?, NULL, NULL, 'Initial engine output', ?)`
    ).run(input.runId, reportJson, now);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface CompleteRunFailureInput {
  runId: string;
  status: "failed" | "canary_triggered";
  stage?: string | null;
  message: string;
  durationMs?: number | null;
  canaryTriggered?: boolean;
}

export function completeRunFailure(db: Database, input: CompleteRunFailureInput): void {
  const now = Date.now();
  db.prepare(
    `UPDATE runs
       SET status = ?,
           failure_stage = ?,
           failure_message = ?,
           duration_ms = ?,
           canary_triggered = ?,
           completed_at = ?
     WHERE id = ?`
  ).run(
    input.status,
    input.stage ?? null,
    input.message.slice(0, 4000),
    input.durationMs ?? null,
    input.canaryTriggered ? 1 : 0,
    now,
    input.runId
  );
}

/**
 * Append a progress event for a run. The sequence is auto-incremented
 * within (run_id) so events have a stable total order even when many
 * land in the same millisecond. Idempotency is the caller's job — the
 * engine only emits each event once.
 */
export function appendRunEvent(db: Database, runId: string, event: RunProgressEvent): RunEventRow {
  // SQLite doesn't have a native "next sequence per group", so we do it
  // explicitly. This races if multiple workers append for the same run,
  // but in our single-worker model only one writer touches a given run.
  const next =
    ((
      db.prepare(`SELECT COALESCE(MAX(sequence), -1) AS max FROM run_events WHERE run_id = ?`).get(runId) as
        | { max: number }
        | undefined
    )?.max ?? -1) + 1;
  const now = Date.now();
  const dataJson = event.data ? JSON.stringify(event.data) : null;
  db.prepare(
    `INSERT INTO run_events (run_id, sequence, stage, message, elapsed_ms, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(runId, next, event.stage, event.message, event.elapsedMs, dataJson, now);
  return {
    runId,
    sequence: next,
    stage: event.stage,
    message: event.message,
    elapsedMs: event.elapsedMs,
    data: event.data ?? null,
    createdAt: now
  };
}

/**
 * List events for a run, in sequence order. `since` is exclusive — pass
 * the last sequence number you've already seen to fetch only new ones
 * (useful for SSE reconnect).
 */
export function listRunEvents(db: Database, runId: string, since = -1): RunEventRow[] {
  const rows = db
    .prepare(
      `SELECT run_id AS runId, sequence, stage, message, elapsed_ms AS elapsedMs,
              data_json AS dataJson, created_at AS createdAt
       FROM run_events WHERE run_id = ? AND sequence > ?
       ORDER BY sequence ASC`
    )
    .all(runId, since) as Array<{
    runId: string;
    sequence: number;
    stage: string;
    message: string;
    elapsedMs: number;
    dataJson: string | null;
    createdAt: number;
  }>;
  return rows.map((r) => ({
    runId: r.runId,
    sequence: r.sequence,
    stage: r.stage,
    message: r.message,
    elapsedMs: r.elapsedMs,
    data: r.dataJson ? (JSON.parse(r.dataJson) as Record<string, unknown>) : null,
    createdAt: r.createdAt
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────

interface RawRunRow {
  id: string;
  projectId: string;
  template: string;
  providerId: string;
  model: string;
  status: RunStatus;
  failureStage: string | null;
  failureMessage: string | null;
  durationMs: number | null;
  canaryTriggered: number;
  verifierFailed: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

const RUN_COLUMNS = `
  id, project_id AS projectId, template, provider_id AS providerId, model, status,
  failure_stage AS failureStage, failure_message AS failureMessage,
  duration_ms AS durationMs, canary_triggered AS canaryTriggered,
  verifier_failed AS verifierFailed, created_at AS createdAt,
  started_at AS startedAt, completed_at AS completedAt`;

function rowToRun(row: RawRunRow): RunRow {
  return {
    id: row.id,
    projectId: row.projectId,
    template: row.template,
    providerId: row.providerId,
    model: row.model,
    status: row.status,
    failureStage: row.failureStage,
    failureMessage: row.failureMessage,
    durationMs: row.durationMs,
    canaryTriggered: row.canaryTriggered === 1,
    verifierFailed: row.verifierFailed === 1,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  };
}

export function listRuns(
  db: Database,
  options: { projectId?: string; limit?: number; offset?: number } = {}
): RunRow[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where = options.projectId ? "WHERE project_id = ?" : "";
  const stmt = db.prepare(
    `SELECT${RUN_COLUMNS} FROM runs ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  );
  const rows = (options.projectId
    ? stmt.all(options.projectId, limit, offset)
    : stmt.all(limit, offset)) as unknown as RawRunRow[];
  return rows.map(rowToRun);
}

export function getRun(db: Database, id: string): RunWithReport | null {
  const runRow = db.prepare(`SELECT${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id) as RawRunRow | undefined;
  if (!runRow) return null;
  const run = rowToRun(runRow);

  const project = getProject(db, run.projectId);
  if (!project) return null;

  const chunks = (
    db
      .prepare(
        `SELECT id, artifact_id AS artifactId, artifact_name AS artifactName,
                line_start AS lineStart, line_end AS lineEnd, text
         FROM chunks WHERE run_id = ? ORDER BY id`
      )
      .all(id) as Array<{
      id: string;
      artifactId: string;
      artifactName: string;
      lineStart: number;
      lineEnd: number;
      text: string;
    }>
  ).map((r) => ({ ...r }));

  const artifacts = (
    db
      .prepare(
        `SELECT id, name, kind, type, size, content, preview
         FROM artifacts WHERE run_id = ?`
      )
      .all(id) as Array<{
      id: string;
      name: string;
      kind: string;
      type: string;
      size: number;
      content: string | null;
      preview: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind as EvidenceArtifact["kind"],
    type: r.type,
    size: r.size,
    ...(r.content !== null ? { content: r.content } : {}),
    ...(r.preview !== null ? { preview: r.preview } : {})
  }));

  const reportRow = db
    .prepare(
      `SELECT report_json AS reportJson, verdicts_json AS verdictsJson, receipt_json AS receiptJson
       FROM reports WHERE run_id = ?`
    )
    .get(id) as { reportJson: string; verdictsJson: string | null; receiptJson: string } | undefined;

  return {
    ...run,
    project: project.details,
    chunks,
    artifacts,
    report: reportRow ? (JSON.parse(reportRow.reportJson) as VerricReport) : null,
    verdicts: reportRow?.verdictsJson ? (JSON.parse(reportRow.verdictsJson) as GroundingVerdict[]) : null,
    receipt: reportRow ? (JSON.parse(reportRow.receiptJson) as Receipt) : null
  };
}

export function deleteRun(db: Database, id: string): boolean {
  // CASCADE deletes chunks, artifacts, reports.
  const result = db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Editor — versioned reports + claim-edit audit log
// ─────────────────────────────────────────────────────────────────────────

export type ClaimEditAction =
  | "edit_text"
  | "edit_evidence"
  | "accept"
  | "reject"
  | "reground"
  | "flag"
  | "unflag";

export interface ReportVersionRow {
  runId: string;
  version: number;
  report: VerricReport;
  parentVersion: number | null;
  editedBy: string | null;
  editSummary: string | null;
  createdAt: number;
}

export interface ClaimEditRow {
  runId: string;
  version: number;
  sequence: number;
  claimId: string;
  action: ClaimEditAction;
  before: unknown | null;
  after: unknown | null;
  editedBy: string | null;
  createdAt: number;
}

export interface AppendReportVersionInput {
  runId: string;
  report: VerricReport;
  parentVersion: number;
  editedBy?: string | null;
  editSummary?: string | null;
}

/**
 * Append a new report version. Returns the newly assigned version
 * number (1-indexed; the engine's initial output is version 1).
 *
 * Wrapped in a transaction so the version+latest_version flip is atomic.
 */
export function appendReportVersion(db: Database, input: AppendReportVersionInput): number {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    const next =
      ((
        db
          .prepare(`SELECT COALESCE(MAX(version), 0) AS max FROM report_versions WHERE run_id = ?`)
          .get(input.runId) as { max: number } | undefined
      )?.max ?? 0) + 1;
    db.prepare(
      `INSERT INTO report_versions
         (run_id, version, report_json, parent_version, edited_by, edit_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.runId,
      next,
      JSON.stringify(input.report),
      input.parentVersion,
      input.editedBy ?? null,
      input.editSummary ?? null,
      now
    );
    db.prepare(`UPDATE reports SET report_json = ?, latest_version = ? WHERE run_id = ?`).run(
      JSON.stringify(input.report),
      next,
      input.runId
    );
    db.exec("COMMIT");
    return next;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getReportVersion(db: Database, runId: string, version: number): ReportVersionRow | null {
  const row = db
    .prepare(
      `SELECT run_id AS runId, version, report_json AS reportJson,
              parent_version AS parentVersion, edited_by AS editedBy,
              edit_summary AS editSummary, created_at AS createdAt
       FROM report_versions WHERE run_id = ? AND version = ?`
    )
    .get(runId, version) as
    | {
        runId: string;
        version: number;
        reportJson: string;
        parentVersion: number | null;
        editedBy: string | null;
        editSummary: string | null;
        createdAt: number;
      }
    | undefined;
  if (!row) return null;
  return {
    runId: row.runId,
    version: row.version,
    report: JSON.parse(row.reportJson) as VerricReport,
    parentVersion: row.parentVersion,
    editedBy: row.editedBy,
    editSummary: row.editSummary,
    createdAt: row.createdAt
  };
}

export function listReportVersions(db: Database, runId: string): ReportVersionRow[] {
  const rows = db
    .prepare(
      `SELECT run_id AS runId, version, report_json AS reportJson,
              parent_version AS parentVersion, edited_by AS editedBy,
              edit_summary AS editSummary, created_at AS createdAt
       FROM report_versions WHERE run_id = ? ORDER BY version DESC`
    )
    .all(runId) as Array<{
    runId: string;
    version: number;
    reportJson: string;
    parentVersion: number | null;
    editedBy: string | null;
    editSummary: string | null;
    createdAt: number;
  }>;
  return rows.map((r) => ({
    runId: r.runId,
    version: r.version,
    report: JSON.parse(r.reportJson) as VerricReport,
    parentVersion: r.parentVersion,
    editedBy: r.editedBy,
    editSummary: r.editSummary,
    createdAt: r.createdAt
  }));
}

export interface RecordClaimEditInput {
  runId: string;
  version: number;
  claimId: string;
  action: ClaimEditAction;
  before?: unknown;
  after?: unknown;
  editedBy?: string | null;
}

export function recordClaimEdit(db: Database, input: RecordClaimEditInput): ClaimEditRow {
  const next =
    ((
      db
        .prepare(
          `SELECT COALESCE(MAX(sequence), -1) AS max FROM claim_edits WHERE run_id = ? AND version = ?`
        )
        .get(input.runId, input.version) as { max: number } | undefined
    )?.max ?? -1) + 1;
  const now = Date.now();
  db.prepare(
    `INSERT INTO claim_edits
       (run_id, version, sequence, claim_id, action, before_json, after_json, edited_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.version,
    next,
    input.claimId,
    input.action,
    input.before !== undefined ? JSON.stringify(input.before) : null,
    input.after !== undefined ? JSON.stringify(input.after) : null,
    input.editedBy ?? null,
    now
  );
  return {
    runId: input.runId,
    version: input.version,
    sequence: next,
    claimId: input.claimId,
    action: input.action,
    before: input.before ?? null,
    after: input.after ?? null,
    editedBy: input.editedBy ?? null,
    createdAt: now
  };
}

export function listClaimEdits(db: Database, runId: string, claimId?: string): ClaimEditRow[] {
  const where = claimId ? "WHERE run_id = ? AND claim_id = ?" : "WHERE run_id = ?";
  const params: string[] = claimId ? [runId, claimId] : [runId];
  const rows = db
    .prepare(
      `SELECT run_id AS runId, version, sequence, claim_id AS claimId, action,
              before_json AS beforeJson, after_json AS afterJson,
              edited_by AS editedBy, created_at AS createdAt
       FROM claim_edits ${where}
       ORDER BY created_at DESC, sequence DESC`
    )
    .all(...params) as Array<{
    runId: string;
    version: number;
    sequence: number;
    claimId: string;
    action: ClaimEditAction;
    beforeJson: string | null;
    afterJson: string | null;
    editedBy: string | null;
    createdAt: number;
  }>;
  return rows.map((r) => ({
    runId: r.runId,
    version: r.version,
    sequence: r.sequence,
    claimId: r.claimId,
    action: r.action,
    before: r.beforeJson ? JSON.parse(r.beforeJson) : null,
    after: r.afterJson ? JSON.parse(r.afterJson) : null,
    editedBy: r.editedBy,
    createdAt: r.createdAt
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// Finding library — reusable writeups
// ─────────────────────────────────────────────────────────────────────────

export interface FindingLibraryEntry {
  id: string;
  name: string;
  category: string;
  severity: string;
  defaultCvssVector: string | null;
  description: string | null;
  impact: string | null;
  remediation: string | null;
  references: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface UpsertFindingLibraryEntryInput {
  id?: string;
  name: string;
  category: string;
  severity: string;
  defaultCvssVector?: string | null;
  description?: string | null;
  impact?: string | null;
  remediation?: string | null;
  references?: string[];
  tags?: string[];
}

export function upsertFindingLibraryEntry(
  db: Database,
  input: UpsertFindingLibraryEntryInput
): FindingLibraryEntry {
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const existing = db.prepare(`SELECT created_at AS createdAt FROM finding_library WHERE id = ?`).get(id) as
    | { createdAt: number }
    | undefined;
  const createdAt = existing?.createdAt ?? now;
  db.prepare(
    `INSERT INTO finding_library
       (id, name, category, severity, default_cvss_vector, description_text, impact_text,
        remediation_text, references_json, tags_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       category = excluded.category,
       severity = excluded.severity,
       default_cvss_vector = excluded.default_cvss_vector,
       description_text = excluded.description_text,
       impact_text = excluded.impact_text,
       remediation_text = excluded.remediation_text,
       references_json = excluded.references_json,
       tags_json = excluded.tags_json,
       updated_at = excluded.updated_at`
  ).run(
    id,
    input.name,
    input.category,
    input.severity,
    input.defaultCvssVector ?? null,
    input.description ?? null,
    input.impact ?? null,
    input.remediation ?? null,
    JSON.stringify(input.references ?? []),
    JSON.stringify(input.tags ?? []),
    createdAt,
    now
  );
  return {
    id,
    name: input.name,
    category: input.category,
    severity: input.severity,
    defaultCvssVector: input.defaultCvssVector ?? null,
    description: input.description ?? null,
    impact: input.impact ?? null,
    remediation: input.remediation ?? null,
    references: input.references ?? [],
    tags: input.tags ?? [],
    createdAt,
    updatedAt: now
  };
}

interface RawLibraryRow {
  id: string;
  name: string;
  category: string;
  severity: string;
  defaultCvssVector: string | null;
  description: string | null;
  impact: string | null;
  remediation: string | null;
  referencesJson: string | null;
  tagsJson: string | null;
  createdAt: number;
  updatedAt: number;
}

const LIBRARY_COLS = `id, name, category, severity,
  default_cvss_vector AS defaultCvssVector,
  description_text AS description,
  impact_text AS impact,
  remediation_text AS remediation,
  references_json AS referencesJson,
  tags_json AS tagsJson,
  created_at AS createdAt,
  updated_at AS updatedAt`;

function rowToLibraryEntry(r: RawLibraryRow): FindingLibraryEntry {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    severity: r.severity,
    defaultCvssVector: r.defaultCvssVector,
    description: r.description,
    impact: r.impact,
    remediation: r.remediation,
    references: r.referencesJson ? (JSON.parse(r.referencesJson) as string[]) : [],
    tags: r.tagsJson ? (JSON.parse(r.tagsJson) as string[]) : [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function getFindingLibraryEntry(db: Database, id: string): FindingLibraryEntry | null {
  const row = db.prepare(`SELECT ${LIBRARY_COLS} FROM finding_library WHERE id = ?`).get(id) as
    | RawLibraryRow
    | undefined;
  return row ? rowToLibraryEntry(row) : null;
}

export function listFindingLibrary(
  db: Database,
  options: { search?: string; category?: string; limit?: number } = {}
): FindingLibraryEntry[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.category) {
    where.push("category = ?");
    params.push(options.category);
  }
  if (options.search) {
    where.push("(name LIKE ? OR category LIKE ?)");
    const like = `%${options.search}%`;
    params.push(like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  const stmt = db.prepare(
    `SELECT ${LIBRARY_COLS} FROM finding_library ${whereSql} ORDER BY name ASC LIMIT ?`
  );
  const rows = stmt.all(...(params as [string, ...Array<string | number>])) as unknown as RawLibraryRow[];
  return rows.map(rowToLibraryEntry);
}

export function deleteFindingLibraryEntry(db: Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM finding_library WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Branded report templates
// ─────────────────────────────────────────────────────────────────────────

export interface ReportBrandingRow {
  id: string;
  name: string;
  logoDataUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  coverSubtitle: string | null;
  customCss: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertBrandingInput {
  id?: string;
  name: string;
  logoDataUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  footerText?: string | null;
  coverSubtitle?: string | null;
  customCss?: string | null;
  isDefault?: boolean;
}

export function upsertBranding(db: Database, input: UpsertBrandingInput): ReportBrandingRow {
  const id = input.id ?? randomUUID();
  const now = Date.now();
  const existing = db.prepare(`SELECT created_at AS createdAt FROM report_branding WHERE id = ?`).get(id) as
    | { createdAt: number }
    | undefined;
  const createdAt = existing?.createdAt ?? now;

  db.exec("BEGIN");
  try {
    if (input.isDefault) {
      // Only one default at a time.
      db.prepare(`UPDATE report_branding SET is_default = 0 WHERE id != ?`).run(id);
    }
    db.prepare(
      `INSERT INTO report_branding
         (id, name, logo_data_url, primary_color, secondary_color, accent_color,
          footer_text, cover_subtitle, custom_css, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name,
         logo_data_url = excluded.logo_data_url,
         primary_color = excluded.primary_color,
         secondary_color = excluded.secondary_color,
         accent_color = excluded.accent_color,
         footer_text = excluded.footer_text,
         cover_subtitle = excluded.cover_subtitle,
         custom_css = excluded.custom_css,
         is_default = excluded.is_default,
         updated_at = excluded.updated_at`
    ).run(
      id,
      input.name,
      input.logoDataUrl ?? null,
      input.primaryColor ?? null,
      input.secondaryColor ?? null,
      input.accentColor ?? null,
      input.footerText ?? null,
      input.coverSubtitle ?? null,
      input.customCss ?? null,
      input.isDefault ? 1 : 0,
      createdAt,
      now
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    id,
    name: input.name,
    logoDataUrl: input.logoDataUrl ?? null,
    primaryColor: input.primaryColor ?? null,
    secondaryColor: input.secondaryColor ?? null,
    accentColor: input.accentColor ?? null,
    footerText: input.footerText ?? null,
    coverSubtitle: input.coverSubtitle ?? null,
    customCss: input.customCss ?? null,
    isDefault: !!input.isDefault,
    createdAt,
    updatedAt: now
  };
}

const BRANDING_COLS = `id, name,
  logo_data_url AS logoDataUrl,
  primary_color AS primaryColor,
  secondary_color AS secondaryColor,
  accent_color AS accentColor,
  footer_text AS footerText,
  cover_subtitle AS coverSubtitle,
  custom_css AS customCss,
  is_default AS isDefaultRaw,
  created_at AS createdAt,
  updated_at AS updatedAt`;

interface RawBrandingRow {
  id: string;
  name: string;
  logoDataUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  footerText: string | null;
  coverSubtitle: string | null;
  customCss: string | null;
  isDefaultRaw: number;
  createdAt: number;
  updatedAt: number;
}

function rowToBranding(r: RawBrandingRow): ReportBrandingRow {
  return {
    id: r.id,
    name: r.name,
    logoDataUrl: r.logoDataUrl,
    primaryColor: r.primaryColor,
    secondaryColor: r.secondaryColor,
    accentColor: r.accentColor,
    footerText: r.footerText,
    coverSubtitle: r.coverSubtitle,
    customCss: r.customCss,
    isDefault: r.isDefaultRaw === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

export function getBranding(db: Database, id: string): ReportBrandingRow | null {
  const row = db.prepare(`SELECT ${BRANDING_COLS} FROM report_branding WHERE id = ?`).get(id) as
    | RawBrandingRow
    | undefined;
  return row ? rowToBranding(row) : null;
}

export function listBranding(db: Database): ReportBrandingRow[] {
  const rows = db
    .prepare(`SELECT ${BRANDING_COLS} FROM report_branding ORDER BY is_default DESC, name ASC`)
    .all() as unknown as RawBrandingRow[];
  return rows.map(rowToBranding);
}

export function getDefaultBranding(db: Database): ReportBrandingRow | null {
  const row = db
    .prepare(`SELECT ${BRANDING_COLS} FROM report_branding WHERE is_default = 1 LIMIT 1`)
    .get() as RawBrandingRow | undefined;
  return row ? rowToBranding(row) : null;
}

export function deleteBranding(db: Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM report_branding WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Template registry (P7 marketplace)
// ─────────────────────────────────────────────────────────────────────────

export interface TemplateRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string | null;
  source: string | null;
  installedAt: number;
  enabled: boolean;
}

export interface UpsertTemplateInput {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  source?: string | null;
  enabled?: boolean;
}

export function upsertTemplateRegistryEntry(db: Database, input: UpsertTemplateInput): TemplateRegistryEntry {
  const now = Date.now();
  const existing = db
    .prepare(`SELECT installed_at AS installedAt FROM template_registry WHERE id = ?`)
    .get(input.id) as { installedAt: number } | undefined;
  const installedAt = existing?.installedAt ?? now;
  db.prepare(
    `INSERT INTO template_registry (id, name, version, description, source, installed_at, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       version = excluded.version,
       description = excluded.description,
       source = excluded.source,
       enabled = excluded.enabled`
  ).run(
    input.id,
    input.name,
    input.version,
    input.description ?? null,
    input.source ?? null,
    installedAt,
    input.enabled === false ? 0 : 1
  );
  return {
    id: input.id,
    name: input.name,
    version: input.version,
    description: input.description ?? null,
    source: input.source ?? null,
    installedAt,
    enabled: input.enabled !== false
  };
}

export function listTemplateRegistry(db: Database): TemplateRegistryEntry[] {
  const rows = db
    .prepare(
      `SELECT id, name, version, description, source,
              installed_at AS installedAt, enabled AS enabledRaw
       FROM template_registry ORDER BY installed_at DESC`
    )
    .all() as Array<{
    id: string;
    name: string;
    version: string;
    description: string | null;
    source: string | null;
    installedAt: number;
    enabledRaw: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    source: r.source,
    installedAt: r.installedAt,
    enabled: r.enabledRaw === 1
  }));
}

export function deleteTemplateRegistryEntry(db: Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM template_registry WHERE id = ?`).run(id);
  return result.changes > 0;
}
