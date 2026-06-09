import { describe, expect, it } from "vitest";
import { buildReceipt, canonicalJson, digestEvidence, digestReport, verifyReceipt } from "./receipts";
import { emptyProjectDetails } from "./samples";
import type { EvidenceChunk, VerricReport } from "./types";

const CHUNKS: EvidenceChunk[] = [
  {
    id: "ev-001",
    artifactId: "a",
    artifactName: "a.txt",
    lineStart: 1,
    lineEnd: 1,
    text: "alpha"
  },
  {
    id: "ev-002",
    artifactId: "a",
    artifactName: "a.txt",
    lineStart: 2,
    lineEnd: 2,
    text: "bravo"
  }
];

const REPORT: VerricReport = {
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

describe("canonicalJson — deterministic key ordering", () => {
  it("produces the same string regardless of key insertion order", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("sorts keys at every depth", () => {
    expect(canonicalJson({ z: { c: 1, a: 2 }, a: 1 })).toBe('{"a":1,"z":{"a":2,"c":1}}');
  });
});

describe("digestEvidence", () => {
  it("is stable when chunk order changes", () => {
    const reordered = [CHUNKS[1], CHUNKS[0]];
    expect(digestEvidence(reordered)).toBe(digestEvidence(CHUNKS));
  });

  it("changes when chunk content changes", () => {
    const tampered: EvidenceChunk[] = [{ ...CHUNKS[0], text: "ALPHA-modified" }, CHUNKS[1]];
    expect(digestEvidence(tampered)).not.toBe(digestEvidence(CHUNKS));
  });
});

describe("buildReceipt + verifyReceipt — round trip", () => {
  it("verifies cleanly for an unmodified payload", () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "gpt-4o-mini",
      template: "pentest@0.1.0",
      promptHashes: { drafter: "abc", verifier: "def" },
      evidence: CHUNKS,
      report: REPORT,
      verdicts: [{ claimId: "c-1", verdict: "supported" }],
      signingKey: "test-key",
      timestamp: "2026-06-08T20:00:00Z",
      runId: "fixed-run-id"
    });
    const result = verifyReceipt({
      receipt,
      signingKey: "test-key",
      evidence: CHUNKS,
      report: REPORT,
      verdicts: [{ claimId: "c-1", verdict: "supported" }]
    });
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("detects evidence tampering", () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "x",
      template: "pentest@0.1.0",
      promptHashes: { drafter: "abc" },
      evidence: CHUNKS,
      report: REPORT,
      signingKey: "k",
      timestamp: "2026-06-08T20:00:00Z",
      runId: "id-1"
    });
    const tampered: EvidenceChunk[] = [{ ...CHUNKS[0], text: "TAMPERED" }, CHUNKS[1]];
    const result = verifyReceipt({
      receipt,
      signingKey: "k",
      evidence: tampered,
      report: REPORT
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain("evidence");
  });

  it("detects report tampering", () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "x",
      template: "pentest@0.1.0",
      promptHashes: { drafter: "abc" },
      evidence: CHUNKS,
      report: REPORT,
      signingKey: "k",
      timestamp: "2026-06-08T20:00:00Z",
      runId: "id-1"
    });
    const tampered: VerricReport = { ...REPORT, overallRisk: "Critical" };
    const result = verifyReceipt({
      receipt,
      signingKey: "k",
      evidence: CHUNKS,
      report: tampered
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain("report");
  });

  it("detects a wrong signing key", () => {
    const receipt = buildReceipt({
      providerId: "openai",
      model: "x",
      template: "pentest@0.1.0",
      promptHashes: { drafter: "abc" },
      evidence: CHUNKS,
      report: REPORT,
      signingKey: "right-key",
      timestamp: "2026-06-08T20:00:00Z",
      runId: "id-1"
    });
    const result = verifyReceipt({
      receipt,
      signingKey: "wrong-key",
      evidence: CHUNKS,
      report: REPORT
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContain("signature");
  });

  it("digestReport is stable across deep key reorderings", () => {
    const a: VerricReport = REPORT;
    const b: VerricReport = {
      // Same data, different shape order — digestReport uses canonicalJson
      flaggedClaims: [],
      remediationRoadmap: { longTerm: [], mediumTerm: [], shortTerm: [], immediate: [] },
      findings: [],
      methodology: [],
      keyRecommendations: [],
      executiveSummary: [],
      globalGaps: [],
      readinessSummary: "ok",
      reportReadiness: "ready",
      overallRisk: "Medium",
      project: emptyProjectDetails
    };
    expect(digestReport(a)).toBe(digestReport(b));
  });
});
