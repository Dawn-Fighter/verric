import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProjectDetails } from "@verric/core";
import type {
  EvidenceArtifact,
  EvidenceChunk,
  GroundingVerdict,
  Receipt,
  RunProgressEvent,
  VerricReport
} from "@verric/core";
import {
  appendReportVersion,
  appendRunEvent,
  closeDatabase,
  completeRunFailure,
  completeRunSuccess,
  createPendingRun,
  createProject,
  deleteBranding,
  deleteFindingLibraryEntry,
  deleteRun,
  deleteTemplateRegistryEntry,
  findOrCreateProject,
  getBranding,
  getDefaultBranding,
  getFindingLibraryEntry,
  getProject,
  getReportVersion,
  getRun,
  listBranding,
  listClaimEdits,
  listFindingLibrary,
  listReportVersions,
  listRunEvents,
  listRuns,
  listTemplateRegistry,
  markRunRunning,
  migrate,
  openDatabase,
  readSchemaVersion,
  recordClaimEdit,
  recordRun,
  SCHEMA_VERSION,
  upsertBranding,
  upsertFindingLibraryEntry,
  upsertTemplateRegistryEntry,
  type Database
} from "./index";

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

const SAMPLE_CHUNKS: EvidenceChunk[] = [
  { id: "ev-001", artifactId: "a1", artifactName: "scan.txt", lineStart: 1, lineEnd: 1, text: "alpha" },
  { id: "ev-002", artifactId: "a1", artifactName: "scan.txt", lineStart: 2, lineEnd: 2, text: "bravo" }
];

const SAMPLE_ARTIFACTS: EvidenceArtifact[] = [
  { id: "a1", name: "scan.txt", kind: "text", type: "text/plain", size: 11, content: "alpha\nbravo" }
];

const SAMPLE_REPORT: VerricReport = {
  project: emptyProjectDetails,
  overallRisk: "Medium",
  reportReadiness: "ready",
  readinessSummary: "ok",
  globalGaps: [],
  executiveSummary: [],
  keyRecommendations: [],
  methodology: [],
  findings: [],
  remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
  flaggedClaims: []
};

const SAMPLE_RECEIPT: Receipt = {
  version: 1,
  runId: "test-run-id",
  timestamp: "2026-06-08T20:00:00Z",
  providerId: "openai",
  model: "gpt-4o-mini",
  template: "pentest@0.1.0",
  digests: {
    evidence: "abc",
    drafterPrompt: "def",
    report: "ghi"
  },
  evidenceCount: 2,
  signature: "deadbeef",
  algorithm: "HMAC-SHA-256"
};

const SAMPLE_VERDICTS: GroundingVerdict[] = [{ claimId: "c-1", verdict: "supported" }];

// ─────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────

let db: Database;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  migrate(db);
});

afterEach(() => {
  closeDatabase(db);
});

// ─────────────────────────────────────────────────────────────────────────
// Schema / migrations
// ─────────────────────────────────────────────────────────────────────────

describe("migrate — idempotent", () => {
  it("records the schema version after first run", () => {
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("can be called multiple times safely", () => {
    migrate(db);
    migrate(db);
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("creates the projects, runs, chunks, artifacts, reports tables", () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("runs");
    expect(names).toContain("chunks");
    expect(names).toContain("artifacts");
    expect(names).toContain("reports");
    expect(names).toContain("verric_meta");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────

describe("projects", () => {
  it("createProject + getProject round-trip", () => {
    const created = createProject(db, { details: emptyProjectDetails });
    expect(created.id.length).toBeGreaterThan(0);
    const loaded = getProject(db, created.id);
    expect(loaded?.details).toEqual(emptyProjectDetails);
  });

  it("findOrCreateProject reuses an existing row when the brief matches", () => {
    const a = findOrCreateProject(db, emptyProjectDetails);
    const b = findOrCreateProject(db, emptyProjectDetails);
    expect(a.id).toBe(b.id);
    // updated_at should advance
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
  });

  it("findOrCreateProject creates a new row when client/project differ", () => {
    const a = findOrCreateProject(db, emptyProjectDetails);
    const b = findOrCreateProject(db, { ...emptyProjectDetails, clientName: "Other Corp" });
    expect(a.id).not.toBe(b.id);
  });

  it("returns null for unknown project id", () => {
    expect(getProject(db, "nonexistent")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────

describe("recordRun — successful run", () => {
  it("persists run + chunks + artifacts + report + receipt atomically", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      status: "succeeded",
      durationMs: 1234,
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      verdicts: SAMPLE_VERDICTS,
      receipt: SAMPLE_RECEIPT
    });
    expect(runId).toBeTruthy();

    const fetched = getRun(db, runId);
    expect(fetched).not.toBeNull();
    expect(fetched?.status).toBe("succeeded");
    expect(fetched?.chunks).toHaveLength(2);
    expect(fetched?.artifacts).toHaveLength(1);
    expect(fetched?.report).not.toBeNull();
    expect(fetched?.receipt?.signature).toBe("deadbeef");
    expect(fetched?.verdicts).toEqual(SAMPLE_VERDICTS);
  });
});

describe("recordRun — failed run", () => {
  it("persists chunks/artifacts but no report when status=failed", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      status: "failed",
      failureStage: "drafter_call",
      failureMessage: "rate limited",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    const fetched = getRun(db, runId);
    expect(fetched?.status).toBe("failed");
    expect(fetched?.failureStage).toBe("drafter_call");
    expect(fetched?.failureMessage).toBe("rate limited");
    expect(fetched?.report).toBeNull();
    expect(fetched?.receipt).toBeNull();
    // The evidence snapshot is still preserved so operators can inspect what was sent.
    expect(fetched?.chunks).toHaveLength(2);
  });

  it("persists canary_triggered status and metadata flag", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      status: "canary_triggered",
      failureStage: "canary_triggered",
      failureMessage: "Adversarial canary triggered",
      canaryTriggered: true,
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    const fetched = getRun(db, runId);
    expect(fetched?.status).toBe("canary_triggered");
    expect(fetched?.canaryTriggered).toBe(true);
  });
});

describe("listRuns", () => {
  it("returns runs in reverse chronological order", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        recordRun(db, {
          projectId: project.id,
          template: "pentest@0.1.0",
          providerId: "openai",
          model: "gpt-4o-mini",
          status: "succeeded",
          chunks: SAMPLE_CHUNKS,
          artifacts: SAMPLE_ARTIFACTS,
          report: SAMPLE_REPORT,
          receipt: SAMPLE_RECEIPT
        })
      );
    }
    const runs = listRuns(db);
    expect(runs).toHaveLength(3);
    // Most recently created first.
    expect(runs[0].id).toBe(ids[2]);
    expect(runs[2].id).toBe(ids[0]);
  });

  it("filters by projectId when provided", () => {
    const projectA = findOrCreateProject(db, emptyProjectDetails);
    const projectB = findOrCreateProject(db, { ...emptyProjectDetails, clientName: "B Corp" });
    recordRun(db, {
      projectId: projectA.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      status: "succeeded",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      receipt: SAMPLE_RECEIPT
    });
    recordRun(db, {
      projectId: projectB.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      status: "succeeded",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      receipt: SAMPLE_RECEIPT
    });
    expect(listRuns(db, { projectId: projectA.id })).toHaveLength(1);
    expect(listRuns(db, { projectId: projectB.id })).toHaveLength(1);
    expect(listRuns(db)).toHaveLength(2);
  });

  it("respects limit and offset", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    for (let i = 0; i < 5; i++) {
      recordRun(db, {
        projectId: project.id,
        template: "pentest@0.1.0",
        providerId: "openai",
        model: "x",
        status: "succeeded",
        chunks: SAMPLE_CHUNKS,
        artifacts: SAMPLE_ARTIFACTS,
        report: SAMPLE_REPORT,
        receipt: SAMPLE_RECEIPT
      });
    }
    expect(listRuns(db, { limit: 2 })).toHaveLength(2);
    expect(listRuns(db, { limit: 2, offset: 4 })).toHaveLength(1);
  });
});

describe("deleteRun — cascades to chunks/artifacts/reports", () => {
  it("removes the run and all dependent rows in one shot", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      status: "succeeded",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      receipt: SAMPLE_RECEIPT
    });
    expect(deleteRun(db, runId)).toBe(true);
    expect(getRun(db, runId)).toBeNull();
    // dependents are gone
    const chunkCount = (db.prepare(`SELECT COUNT(*) as n FROM chunks`).get() as { n: number }).n;
    const reportCount = (db.prepare(`SELECT COUNT(*) as n FROM reports`).get() as { n: number }).n;
    expect(chunkCount).toBe(0);
    expect(reportCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Async pipeline (queue + events)
// ─────────────────────────────────────────────────────────────────────────

describe("createPendingRun + markRunRunning + completeRunSuccess", () => {
  it("creates a queued run with evidence snapshot", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    const run = getRun(db, runId);
    expect(run?.status).toBe("queued");
    expect(run?.startedAt).toBeNull();
    expect(run?.completedAt).toBeNull();
    expect(run?.chunks).toHaveLength(2);
    expect(run?.report).toBeNull();
  });

  it("markRunRunning transitions queued → running exactly once", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    expect(markRunRunning(db, runId)).toBe(true);
    expect(markRunRunning(db, runId)).toBe(false); // already running
    const run = getRun(db, runId);
    expect(run?.status).toBe("running");
    expect(run?.startedAt).toBeGreaterThan(0);
  });

  it("completeRunSuccess flips the run to succeeded and writes the report", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    markRunRunning(db, runId);
    completeRunSuccess(db, {
      runId,
      durationMs: 4321,
      canaryTriggered: false,
      verifierFailed: false,
      model: "gpt-4o-mini-2024-07-18",
      report: SAMPLE_REPORT,
      verdicts: SAMPLE_VERDICTS,
      receipt: SAMPLE_RECEIPT
    });
    const run = getRun(db, runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.durationMs).toBe(4321);
    expect(run?.completedAt).toBeGreaterThan(0);
    expect(run?.model).toBe("gpt-4o-mini-2024-07-18");
    expect(run?.report).not.toBeNull();
    expect(run?.receipt?.signature).toBe("deadbeef");
  });
});

describe("completeRunFailure", () => {
  it("flips queued/running run to failed with stage + message", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "ollama",
      model: "llama3.1",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    markRunRunning(db, runId);
    completeRunFailure(db, {
      runId,
      status: "failed",
      stage: "drafter_call",
      message: "fetch failed",
      durationMs: 1200
    });
    const run = getRun(db, runId);
    expect(run?.status).toBe("failed");
    expect(run?.failureStage).toBe("drafter_call");
    expect(run?.failureMessage).toBe("fetch failed");
    expect(run?.report).toBeNull();
  });

  it("supports the canary_triggered status", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "gpt-4o-mini",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    completeRunFailure(db, {
      runId,
      status: "canary_triggered",
      stage: "canary_triggered",
      message: "Adversarial canary triggered",
      canaryTriggered: true
    });
    const run = getRun(db, runId);
    expect(run?.status).toBe("canary_triggered");
    expect(run?.canaryTriggered).toBe(true);
  });
});

describe("run events — append + list", () => {
  function makeEvent(stage: string, elapsedMs: number, data?: Record<string, unknown>): RunProgressEvent {
    return {
      stage: stage as RunProgressEvent["stage"],
      message: `event ${stage}`,
      elapsedMs,
      data
    };
  }

  it("appendRunEvent assigns sequential, monotonic sequences per run", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    const a = appendRunEvent(db, runId, makeEvent("started", 0));
    const b = appendRunEvent(db, runId, makeEvent("drafting", 10));
    const c = appendRunEvent(db, runId, makeEvent("drafted", 25));
    expect([a.sequence, b.sequence, c.sequence]).toEqual([0, 1, 2]);
  });

  it("listRunEvents returns events in sequence order", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    appendRunEvent(db, runId, makeEvent("started", 0));
    appendRunEvent(db, runId, makeEvent("drafting", 10));
    appendRunEvent(db, runId, makeEvent("drafted", 25));
    const events = listRunEvents(db, runId);
    expect(events.map((e) => e.stage)).toEqual(["started", "drafting", "drafted"]);
  });

  it("listRunEvents with `since` returns only newer events (SSE reconnect)", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    appendRunEvent(db, runId, makeEvent("started", 0));
    appendRunEvent(db, runId, makeEvent("drafting", 10));
    appendRunEvent(db, runId, makeEvent("drafted", 25));
    const fresh = listRunEvents(db, runId, 0);
    expect(fresh.map((e) => e.stage)).toEqual(["drafting", "drafted"]);
  });

  it("preserves structured data round-trip", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    appendRunEvent(db, runId, makeEvent("verified", 12345, { verdictCount: 3, model: "fake" }));
    const [event] = listRunEvents(db, runId);
    expect(event.data).toEqual({ verdictCount: 3, model: "fake" });
    expect(event.elapsedMs).toBe(12345);
  });

  it("cascade-deletes events when the run is deleted", () => {
    const project = findOrCreateProject(db, emptyProjectDetails);
    const runId = createPendingRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS
    });
    appendRunEvent(db, runId, makeEvent("started", 0));
    appendRunEvent(db, runId, makeEvent("drafting", 10));
    deleteRun(db, runId);
    const eventCount = (db.prepare(`SELECT COUNT(*) as n FROM run_events`).get() as { n: number }).n;
    expect(eventCount).toBe(0);
  });
});

describe("schema version", () => {
  it("reports v4 after migrate", () => {
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Editor — versioned reports + claim-edit audit log
// ─────────────────────────────────────────────────────────────────────────

describe("editor — versioned reports", () => {
  function seedSucceededRun() {
    const project = findOrCreateProject(db, emptyProjectDetails);
    return recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      status: "succeeded",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      receipt: SAMPLE_RECEIPT
    });
  }

  it("recordRun seeds report_versions v1 automatically", () => {
    const runId = seedSucceededRun();
    const versions = listReportVersions(db, runId);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].editSummary).toBe("Initial engine output");
  });

  it("appendReportVersion increments the version + flips the latest pointer", () => {
    const runId = seedSucceededRun();
    const edited: VerricReport = { ...SAMPLE_REPORT, overallRisk: "High" };
    const v2 = appendReportVersion(db, {
      runId,
      report: edited,
      parentVersion: 1,
      editedBy: "alice",
      editSummary: "Bumped overall risk"
    });
    expect(v2).toBe(2);
    const versions = listReportVersions(db, runId);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // The reports row now reflects the latest.
    const run = getRun(db, runId);
    expect(run?.report?.overallRisk).toBe("High");
  });

  it("getReportVersion returns the exact snapshot for an older version", () => {
    const runId = seedSucceededRun();
    appendReportVersion(db, {
      runId,
      report: { ...SAMPLE_REPORT, overallRisk: "Critical" },
      parentVersion: 1
    });
    const v1 = getReportVersion(db, runId, 1);
    expect(v1?.report.overallRisk).toBe("Medium"); // sample value, unchanged
    const v2 = getReportVersion(db, runId, 2);
    expect(v2?.report.overallRisk).toBe("Critical");
  });
});

describe("editor — claim-edit audit log", () => {
  function seedSucceededRun() {
    const project = findOrCreateProject(db, emptyProjectDetails);
    return recordRun(db, {
      projectId: project.id,
      template: "pentest@0.1.0",
      providerId: "openai",
      model: "x",
      status: "succeeded",
      chunks: SAMPLE_CHUNKS,
      artifacts: SAMPLE_ARTIFACTS,
      report: SAMPLE_REPORT,
      receipt: SAMPLE_RECEIPT
    });
  }

  it("recordClaimEdit appends sequential entries per (run,version)", () => {
    const runId = seedSucceededRun();
    const a = recordClaimEdit(db, {
      runId,
      version: 1,
      claimId: "sum-001",
      action: "edit_text",
      before: { text: "old" },
      after: { text: "new" },
      editedBy: "alice"
    });
    const b = recordClaimEdit(db, {
      runId,
      version: 1,
      claimId: "sum-001",
      action: "reground",
      before: { status: "needs_review" },
      after: { status: "grounded" }
    });
    expect(a.sequence).toBe(0);
    expect(b.sequence).toBe(1);
    const all = listClaimEdits(db, runId, "sum-001");
    expect(all).toHaveLength(2);
    expect(all[0].action).toBe("reground"); // most-recent-first
  });

  it("listClaimEdits scoped to a run returns every claim's edits", () => {
    const runId = seedSucceededRun();
    recordClaimEdit(db, { runId, version: 1, claimId: "a", action: "accept" });
    recordClaimEdit(db, { runId, version: 1, claimId: "b", action: "reject" });
    expect(listClaimEdits(db, runId)).toHaveLength(2);
    expect(listClaimEdits(db, runId, "a")).toHaveLength(1);
  });

  it("cascade-deletes claim_edits when the run is deleted", () => {
    const runId = seedSucceededRun();
    recordClaimEdit(db, { runId, version: 1, claimId: "a", action: "accept" });
    deleteRun(db, runId);
    const n = (db.prepare("SELECT COUNT(*) AS n FROM claim_edits").get() as { n: number }).n;
    expect(n).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Finding library
// ─────────────────────────────────────────────────────────────────────────

describe("finding library", () => {
  it("upsert + get round-trip preserves all fields", () => {
    const entry = upsertFindingLibraryEntry(db, {
      name: "Reflected XSS",
      category: "Injection",
      severity: "High",
      defaultCvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N",
      description: "User input is reflected without encoding.",
      impact: "Attacker can execute JS in the victim's browser.",
      remediation: "Output-encode all user-controlled values; apply CSP.",
      references: ["OWASP Top 10 A03: Injection", "CWE-79"],
      tags: ["web", "xss", "owasp"]
    });
    const fetched = getFindingLibraryEntry(db, entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Reflected XSS");
    expect(fetched?.references).toEqual(["OWASP Top 10 A03: Injection", "CWE-79"]);
    expect(fetched?.tags).toEqual(["web", "xss", "owasp"]);
  });

  it("upsert by id replaces existing entry and bumps updated_at only", () => {
    const a = upsertFindingLibraryEntry(db, {
      name: "x",
      category: "y",
      severity: "Low"
    });
    const b = upsertFindingLibraryEntry(db, {
      id: a.id,
      name: "renamed",
      category: "y",
      severity: "Medium"
    });
    expect(b.id).toBe(a.id);
    expect(b.name).toBe("renamed");
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
  });

  it("listFindingLibrary supports search + category filter", () => {
    upsertFindingLibraryEntry(db, { name: "SQL Injection", category: "Injection", severity: "Critical" });
    upsertFindingLibraryEntry(db, { name: "Reflected XSS", category: "Injection", severity: "High" });
    upsertFindingLibraryEntry(db, { name: "Weak TLS", category: "Crypto", severity: "Medium" });
    expect(listFindingLibrary(db)).toHaveLength(3);
    expect(listFindingLibrary(db, { category: "Injection" })).toHaveLength(2);
    expect(listFindingLibrary(db, { search: "SQL" })).toHaveLength(1);
  });

  it("deleteFindingLibraryEntry removes the row", () => {
    const e = upsertFindingLibraryEntry(db, { name: "tmp", category: "x", severity: "Low" });
    expect(deleteFindingLibraryEntry(db, e.id)).toBe(true);
    expect(getFindingLibraryEntry(db, e.id)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branded report templates
// ─────────────────────────────────────────────────────────────────────────

describe("branded templates", () => {
  it("upsert + get round-trip; list returns inserted entries", () => {
    const b = upsertBranding(db, {
      name: "Acme house style",
      logoDataUrl: "data:image/png;base64,iVBORw0K…",
      primaryColor: "#c73524",
      secondaryColor: "#17140f",
      accentColor: "#a06422",
      footerText: "© 2026 Acme Security",
      coverSubtitle: "Confidential — penetration test report",
      isDefault: true
    });
    const fetched = getBranding(db, b.id);
    expect(fetched?.name).toBe("Acme house style");
    expect(fetched?.isDefault).toBe(true);
    expect(listBranding(db)).toHaveLength(1);
  });

  it("only one branding can be default at a time", () => {
    const a = upsertBranding(db, { name: "A", isDefault: true });
    const b = upsertBranding(db, { name: "B", isDefault: true });
    expect(getBranding(db, a.id)?.isDefault).toBe(false);
    expect(getBranding(db, b.id)?.isDefault).toBe(true);
    expect(getDefaultBranding(db)?.id).toBe(b.id);
  });

  it("deleteBranding returns true when removed, false otherwise", () => {
    const a = upsertBranding(db, { name: "A" });
    expect(deleteBranding(db, a.id)).toBe(true);
    expect(deleteBranding(db, a.id)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Template registry (P7 marketplace)
// ─────────────────────────────────────────────────────────────────────────

describe("template registry", () => {
  it("upsert + list registered templates", () => {
    upsertTemplateRegistryEntry(db, {
      id: "pentest@0.1.0",
      name: "Pentest report",
      version: "0.1.0",
      description: "Reference template",
      source: "@verric/core"
    });
    upsertTemplateRegistryEntry(db, {
      id: "postmortem@0.1.0",
      name: "Incident postmortem",
      version: "0.1.0",
      description: "Blameless postmortem",
      source: "@verric/core"
    });
    expect(
      listTemplateRegistry(db)
        .map((t) => t.id)
        .sort()
    ).toEqual(["pentest@0.1.0", "postmortem@0.1.0"]);
  });

  it("can disable a template without removing it", () => {
    upsertTemplateRegistryEntry(db, { id: "x", name: "x", version: "1.0.0" });
    const updated = upsertTemplateRegistryEntry(db, {
      id: "x",
      name: "x",
      version: "1.0.0",
      enabled: false
    });
    expect(updated.enabled).toBe(false);
    expect(listTemplateRegistry(db)[0].enabled).toBe(false);
  });

  it("delete removes the entry", () => {
    upsertTemplateRegistryEntry(db, { id: "x", name: "x", version: "1.0.0" });
    expect(deleteTemplateRegistryEntry(db, "x")).toBe(true);
    expect(listTemplateRegistry(db)).toHaveLength(0);
  });
});
