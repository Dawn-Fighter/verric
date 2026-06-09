import { describe, expect, it } from "vitest";
import { parseReportJson, VerricReportSchema } from "./schema";

// The schema is the type-safe contract between the LLM and the rest of
// the pipeline. Locking critical edge cases:
//   - tolerates missing fields (validateReport normalizes them)
//   - rejects bad enum values (the LLM cannot invent severities)
//   - returns a Result, never throws on bad JSON

describe("parseReportJson", () => {
  it("returns ok=false on invalid JSON syntax", () => {
    const result = parseReportJson("not json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/JSON parse failed/);
    }
  });

  it("returns ok=false on a wrong enum value (severity=Bogus)", () => {
    const bad = JSON.stringify({
      project: {
        clientName: "",
        projectName: "",
        assessmentType: "",
        preparedBy: "",
        testerName: "",
        classification: "",
        startDate: "",
        endDate: "",
        reportDate: "",
        scope: "",
        outOfScope: "",
        rulesOfEngagement: "",
        methodology: "",
        toolsUsed: ""
      },
      overallRisk: "Bogus"
    });
    const result = parseReportJson(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("accepts a minimal payload by filling missing fields", () => {
    const minimal = JSON.stringify({
      project: {
        clientName: "Acme",
        projectName: "Test",
        assessmentType: "WAPT",
        preparedBy: "Verric",
        testerName: "Tester",
        classification: "Confidential",
        startDate: "2026-06-08",
        endDate: "2026-06-08",
        reportDate: "2026-06-08",
        scope: "x",
        outOfScope: "",
        rulesOfEngagement: "",
        methodology: "",
        toolsUsed: ""
      }
    });
    const result = parseReportJson(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.findings).toEqual([]);
      expect(result.report.flaggedClaims).toEqual([]);
      expect(result.report.executiveSummary).toEqual([]);
    }
  });

  it("preserves a complete payload round-trip", () => {
    const full = {
      project: {
        clientName: "Acme",
        projectName: "Test",
        assessmentType: "WAPT",
        preparedBy: "Verric",
        testerName: "Tester",
        classification: "Confidential",
        startDate: "2026-06-08",
        endDate: "2026-06-08",
        reportDate: "2026-06-08",
        scope: "x",
        outOfScope: "y",
        rulesOfEngagement: "z",
        methodology: "OWASP WSTG",
        toolsUsed: "Nmap"
      },
      overallRisk: "High",
      reportReadiness: "ready",
      readinessSummary: "ready",
      globalGaps: [],
      executiveSummary: [{ id: "sum-1", text: "All good.", evidenceIds: ["ev-001"], status: "grounded" }],
      keyRecommendations: [],
      methodology: ["OWASP"],
      findings: [],
      remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
      flaggedClaims: []
    };
    const result = parseReportJson(JSON.stringify(full));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(VerricReportSchema.safeParse(result.report).success).toBe(true);
      expect(result.report.executiveSummary[0].text).toBe("All good.");
    }
  });
});
