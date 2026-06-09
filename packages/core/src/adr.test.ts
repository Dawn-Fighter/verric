import { describe, expect, it } from "vitest";
import {
  adrTemplate,
  emptyProjectDetails,
  pentestTemplate,
  postmortemTemplate,
  runReport,
  type EvidenceChunk,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse
} from "./index";

function fakeProvider(responses: Array<LLMResponse | Error>): LLMProvider & { calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];
  return {
    id: "fake",
    model: "fake-model",
    calls,
    async generate(req) {
      calls.push(req);
      const next = responses.shift();
      if (!next) throw new Error("No more fake responses queued");
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

const CHUNKS: EvidenceChunk[] = [
  {
    id: "ev-001",
    artifactId: "pr",
    artifactName: "pr-42.md",
    lineStart: 1,
    lineEnd: 1,
    text: "PR #42: Adopt Postgres LISTEN/NOTIFY for the job queue instead of Redis"
  },
  {
    id: "ev-002",
    artifactId: "pr",
    artifactName: "pr-42-commits.md",
    lineStart: 1,
    lineEnd: 1,
    text: "commit: remove redis dependency; wire pg notify channel"
  }
];

const ADR_REPORT_JSON = JSON.stringify({
  project: emptyProjectDetails,
  overallRisk: "Medium",
  reportReadiness: "ready",
  readinessSummary: "ok",
  globalGaps: [],
  executiveSummary: [
    {
      id: "sum-001",
      text: "The job queue moves from Redis to Postgres LISTEN/NOTIFY to drop an infra dependency.",
      evidenceIds: ["ev-001", "ev-002"],
      status: "grounded"
    }
  ],
  keyRecommendations: [
    {
      id: "rec-001",
      text: "Remove the Redis service from deploy manifests.",
      evidenceIds: ["ev-002"],
      status: "grounded"
    }
  ],
  methodology: ["PR review", "commit analysis"],
  findings: [
    {
      id: "VRC-001",
      title: "Adopt Postgres LISTEN/NOTIFY for the job queue",
      severity: "Medium",
      cvss: "N/A",
      cvssVector: "N/A",
      affectedAssets: ["job-queue"],
      status: "Ready for Report",
      category: "Decision Driver",
      readiness: "ready",
      readinessSummary: "ok",
      gaps: [],
      description: [
        {
          id: "vrc-001-desc-001",
          text: "PR #42 replaces Redis with pg notify.",
          evidenceIds: ["ev-001"],
          status: "grounded"
        }
      ],
      impact: [
        {
          id: "vrc-001-impact-001",
          text: "One fewer service to operate.",
          evidenceIds: ["ev-001"],
          status: "grounded"
        }
      ],
      proofOfConcept: [
        {
          id: "vrc-001-poc-001",
          text: "Commit removes the redis dependency.",
          evidenceIds: ["ev-002"],
          status: "grounded"
        }
      ],
      remediation: [],
      references: []
    }
  ],
  remediationRoadmap: {
    immediate: ["Merge PR #42"],
    shortTerm: ["Remove Redis from infra"],
    mediumTerm: [],
    longTerm: []
  },
  flaggedClaims: []
});

const ALL_SUPPORTED = JSON.stringify({
  verdicts: [
    { claimId: "sum-001", verdict: "supported" },
    { claimId: "vrc-001-desc-001", verdict: "supported" },
    { claimId: "vrc-001-impact-001", verdict: "supported" },
    { claimId: "vrc-001-poc-001", verdict: "supported" }
  ]
});

describe("adrTemplate", () => {
  it("has an id distinct from pentest + postmortem", () => {
    expect(adrTemplate.id).toBe("adr@0.1.0");
    expect(adrTemplate.id).not.toBe(pentestTemplate.id);
    expect(adrTemplate.id).not.toBe(postmortemTemplate.id);
  });

  it("buildDrafterPrompt produces an ADR-flavored prompt that delimits evidence", () => {
    const built = adrTemplate.buildDrafterPrompt({
      project: emptyProjectDetails,
      chunks: CHUNKS,
      artifacts: []
    });
    expect(built.system).toContain("Architecture Decision Record");
    expect(built.user).toContain("Alternative Considered");
    expect(built.user).toContain(built.evidenceDelimiter);
    expect(built.user).toContain("ev-001");
    expect(built.user).toContain("ev-002");
  });
});

describe("runReport with templateImpl=adrTemplate", () => {
  it("uses the ADR prompt and records the ADR template id in the receipt", async () => {
    const provider = fakeProvider([
      { text: ADR_REPORT_JSON, model: "fake-1" },
      { text: ALL_SUPPORTED, model: "fake-1" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      templateImpl: adrTemplate,
      signingKey: "test"
    });
    expect(provider.calls[0].messages[0].content).toContain("Architecture Decision Record");
    expect(result.receipt.template).toBe("adr@0.1.0");
    const finding = result.report.findings[0];
    expect(finding.category).toBe("Decision Driver");
    expect(finding.cvss).toBe("N/A");
    expect(finding.severity).toBe("Medium");
  });
});
