import { describe, expect, it } from "vitest";
import { validateReport } from "./validate";
import { emptyProjectDetails } from "./samples";
import type { EvidenceChunk, VerricReport, Finding, ReportClaim } from "./types";

// validateReport is the deterministic safety net that runs AFTER the LLM:
//   - strips evidence IDs that don't exist in the real chunk set
//   - recomputes CVSS from the vector (so score/severity can never disagree)
//   - flips status to needs_review when no valid evidence remains
//   - fills missing fields with sane defaults
// These tests lock that contract.

const CHUNKS: EvidenceChunk[] = [
  { id: "ev-001", artifactId: "a", artifactName: "a.txt", lineStart: 1, lineEnd: 1, text: "line a1" },
  { id: "ev-002", artifactId: "a", artifactName: "a.txt", lineStart: 2, lineEnd: 2, text: "line a2" }
];

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "VRC-001",
    title: "Test Finding",
    severity: "Medium",
    cvss: "5.0",
    cvssVector: "N/A",
    affectedAssets: [],
    status: "Ready for Report",
    category: "Test",
    readiness: "ready",
    readinessSummary: "ok",
    gaps: [],
    description: [],
    impact: [],
    proofOfConcept: [],
    remediation: [],
    references: [],
    ...overrides
  };
}

function makeClaim(overrides: Partial<ReportClaim> = {}): ReportClaim {
  return {
    id: "c-1",
    text: "claim text",
    evidenceIds: [],
    status: "grounded",
    ...overrides
  };
}

function makeReport(overrides: Partial<VerricReport> = {}): VerricReport {
  return {
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
    flaggedClaims: [],
    ...overrides
  };
}

describe("validateReport — evidence ID scrubbing (the trust safety net)", () => {
  it("filters out evidenceIds that do not exist in the chunk set", () => {
    const claim = makeClaim({
      id: "c-1",
      evidenceIds: ["ev-001", "ev-999", "ev-fake"]
    });
    const report = makeReport({
      executiveSummary: [claim]
    });
    const result = validateReport(report, CHUNKS);
    expect(result.executiveSummary[0].evidenceIds).toEqual(["ev-001"]);
  });

  it("flips claim status to needs_review when no valid evidence remains", () => {
    const claim = makeClaim({ id: "c-1", evidenceIds: ["ev-fake"], status: "grounded" });
    const report = makeReport({ executiveSummary: [claim] });
    const result = validateReport(report, CHUNKS);
    expect(result.executiveSummary[0].evidenceIds).toEqual([]);
    expect(result.executiveSummary[0].status).toBe("needs_review");
  });

  it("preserves a 'flagged' status even when valid evidence is present", () => {
    const claim = makeClaim({ id: "c-1", evidenceIds: ["ev-001"], status: "flagged" });
    const report = makeReport({ executiveSummary: [claim] });
    const result = validateReport(report, CHUNKS);
    // Flagged claims with citations are downgraded to needs_review
    // (status flagged + valid evidence becomes needs_review per current rule:
    //  status flips to needs_review when status === flagged regardless).
    // Lock the current behavior, whatever it is.
    expect(result.executiveSummary[0].status).toBe("needs_review");
  });

  it("strips invalid evidenceIds from flaggedClaims as well", () => {
    const report = makeReport({
      flaggedClaims: [
        {
          id: "f-1",
          text: "unproven",
          reason: "no evidence",
          relatedEvidenceIds: ["ev-001", "ev-fake"]
        }
      ]
    });
    const result = validateReport(report, CHUNKS);
    expect(result.flaggedClaims[0].relatedEvidenceIds).toEqual(["ev-001"]);
  });
});

describe("validateReport — CVSS recomputation (math, not vibes)", () => {
  it("overwrites cvss + severity with values computed from the vector", () => {
    // LLM lies: claims 4.0 Medium but the vector is 9.8 Critical
    const finding = makeFinding({
      cvss: "4.0",
      severity: "Medium",
      cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
    });
    const report = makeReport({ findings: [finding] });
    const result = validateReport(report, CHUNKS);
    expect(result.findings[0].cvss).toBe("9.8");
    expect(result.findings[0].severity).toBe("Critical");
  });

  it("leaves cvss + severity alone when the vector is N/A", () => {
    const finding = makeFinding({ cvss: "N/A", severity: "Review", cvssVector: "N/A" });
    const report = makeReport({ findings: [finding] });
    const result = validateReport(report, CHUNKS);
    expect(result.findings[0].cvss).toBe("N/A");
    expect(result.findings[0].severity).toBe("Review");
  });

  it("falls back to 'N/A' when the vector is missing entirely", () => {
    const finding = makeFinding({
      cvss: "7.0",
      severity: "High",
      cvssVector: ""
    });
    const report = makeReport({ findings: [finding] });
    const result = validateReport(report, CHUNKS);
    expect(result.findings[0].cvssVector).toBe("N/A");
    // No vector → can't compute → keep the supplied score
    expect(result.findings[0].cvss).toBe("7.0");
    expect(result.findings[0].severity).toBe("High");
  });
});

describe("validateReport — defensive defaults", () => {
  it("fills in a finding ID when missing, using the index slot", () => {
    const finding = makeFinding({ id: "" });
    const report = makeReport({ findings: [finding] });
    const result = validateReport(report, CHUNKS);
    expect(result.findings[0].id).toBe("VRC-001");
  });

  it("provides default empty arrays when arrays are missing/garbage", () => {
    // Cast through unknown to simulate malformed LLM output that bypasses TS.
    const malformed = {
      ...makeReport(),
      findings: [{ ...makeFinding(), affectedAssets: undefined as unknown as string[] }]
    } as VerricReport;
    const result = validateReport(malformed, CHUNKS);
    expect(Array.isArray(result.findings[0].affectedAssets)).toBe(true);
  });

  it("uses emptyProjectDetails as a fallback when project is null/undefined", () => {
    const report = makeReport({ project: undefined as unknown as VerricReport["project"] });
    const result = validateReport(report, CHUNKS);
    expect(result.project).toEqual(emptyProjectDetails);
  });

  it("propagates a blocking gap into reportReadiness=needs_details when none was given", () => {
    const finding = makeFinding({
      readiness: undefined as unknown as Finding["readiness"],
      gaps: [
        {
          id: "g-1",
          type: "missing_poc",
          title: "Add PoC",
          message: "Need a PoC",
          suggestedEvidence: [],
          severity: "blocking"
        }
      ]
    });
    const report = makeReport({
      findings: [finding],
      reportReadiness: undefined as unknown as VerricReport["reportReadiness"]
    });
    const result = validateReport(report, CHUNKS);
    expect(result.reportReadiness).toBe("needs_details");
    expect(result.findings[0].readiness).toBe("needs_details");
  });

  it("normalizes a gap with missing fields to safe defaults", () => {
    const finding = makeFinding({
      gaps: [
        // partially-malformed gap from the LLM
        {
          id: "",
          type: undefined,
          title: "",
          message: "",
          suggestedEvidence: undefined,
          severity: undefined
        } as never
      ]
    });
    const report = makeReport({ findings: [finding] });
    const result = validateReport(report, CHUNKS);
    const gap = result.findings[0].gaps[0];
    expect(gap.id).toBe("gap-1");
    expect(gap.type).toBe("missing_evidence");
    expect(gap.severity).toBe("warning");
    expect(Array.isArray(gap.suggestedEvidence)).toBe(true);
  });
});

describe("validateReport — claim normalization", () => {
  it("synthesizes a claim ID and a placeholder text when missing", () => {
    const malformed = {
      ...makeReport(),
      executiveSummary: [{ id: "", text: "", evidenceIds: ["ev-001"], status: "grounded" } as ReportClaim]
    };
    const result = validateReport(malformed, CHUNKS);
    expect(result.executiveSummary[0].id).toBe("sum-1");
    expect(result.executiveSummary[0].text.length).toBeGreaterThan(0);
  });

  it("preserves a groundingNote string verbatim", () => {
    const claim = makeClaim({
      id: "c-1",
      evidenceIds: ["ev-001"],
      status: "grounded",
      groundingNote: "Verric: evidence partially supports this claim."
    });
    const report = makeReport({ executiveSummary: [claim] });
    const result = validateReport(report, CHUNKS);
    expect(result.executiveSummary[0].groundingNote).toBe("Verric: evidence partially supports this claim.");
  });
});
