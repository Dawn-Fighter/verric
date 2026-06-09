import { describe, expect, it, vi } from "vitest";
import {
  emptyProjectDetails,
  postmortemTemplate,
  pentestTemplate,
  runReport,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type EvidenceChunk
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
    artifactId: "slack",
    artifactName: "incident-1234.json",
    lineStart: 1,
    lineEnd: 1,
    text: "Slack #incident-1234 12:01 alice: Search latency spiked to 8s p95"
  },
  {
    id: "ev-002",
    artifactId: "pd",
    artifactName: "pd.json",
    lineStart: 1,
    lineEnd: 1,
    text: "PagerDuty #876 [high/triggered] Search degraded · search-api"
  }
];

const POSTMORTEM_REPORT_JSON = JSON.stringify({
  project: emptyProjectDetails,
  overallRisk: "High",
  reportReadiness: "ready",
  readinessSummary: "ok",
  globalGaps: [],
  executiveSummary: [
    {
      id: "sum-001",
      text: "Search latency rose to 8s p95 starting 12:01.",
      evidenceIds: ["ev-001", "ev-002"],
      status: "grounded"
    }
  ],
  keyRecommendations: [
    {
      id: "rec-001",
      text: "Add automated rollback when p95 exceeds threshold.",
      evidenceIds: ["ev-001"],
      status: "grounded"
    }
  ],
  methodology: ["Slack timeline reconstruction", "PagerDuty alert review"],
  findings: [
    {
      id: "VRC-001",
      title: "Cache eviction policy dropped warm entries during deploy",
      severity: "High",
      cvss: "N/A",
      cvssVector: "N/A",
      affectedAssets: ["search-api"],
      status: "Ready for Report",
      category: "Root Cause",
      readiness: "ready",
      readinessSummary: "ok",
      gaps: [],
      description: [
        {
          id: "vrc-001-desc-001",
          text: "Search latency rose to 8s p95 immediately after deploy.",
          evidenceIds: ["ev-001"],
          status: "grounded"
        }
      ],
      impact: [
        {
          id: "vrc-001-impact-001",
          text: "End users saw degraded search.",
          evidenceIds: ["ev-001"],
          status: "grounded"
        }
      ],
      proofOfConcept: [
        {
          id: "vrc-001-poc-001",
          text: "PagerDuty incident #876 fired at 12:03.",
          evidenceIds: ["ev-002"],
          status: "grounded"
        }
      ],
      remediation: [],
      references: []
    }
  ],
  remediationRoadmap: {
    immediate: ["Disable cache eviction on deploy"],
    shortTerm: ["Add rollback automation"],
    mediumTerm: [],
    longTerm: []
  },
  flaggedClaims: []
});

const POSTMORTEM_VERDICTS_JSON = JSON.stringify({
  verdicts: [
    { claimId: "sum-001", verdict: "supported" },
    { claimId: "vrc-001-desc-001", verdict: "supported" },
    { claimId: "vrc-001-impact-001", verdict: "supported" },
    { claimId: "vrc-001-poc-001", verdict: "supported" }
  ]
});

describe("postmortemTemplate", () => {
  it("registers an id distinct from pentest", () => {
    expect(postmortemTemplate.id).toBe("postmortem@0.1.0");
    expect(postmortemTemplate.id).not.toBe(pentestTemplate.id);
  });

  it("buildDrafterPrompt produces a postmortem-flavored prompt that wraps evidence in a delimiter", () => {
    const built = postmortemTemplate.buildDrafterPrompt({
      project: emptyProjectDetails,
      chunks: CHUNKS,
      artifacts: []
    });
    expect(built.system).toContain("incident-postmortem author");
    expect(built.system).toContain("blameless");
    expect(built.user).toContain("blameless postmortem");
    expect(built.user).toContain(built.evidenceDelimiter);
    // Each chunk id is referenced inside the delimiter block.
    expect(built.user).toContain("ev-001");
    expect(built.user).toContain("ev-002");
  });
});

describe("runReport with templateImpl=postmortemTemplate", () => {
  it("uses the postmortem prompt and records the postmortem template id in the receipt", async () => {
    const provider = fakeProvider([
      { text: POSTMORTEM_REPORT_JSON, model: "fake-1" },
      { text: POSTMORTEM_VERDICTS_JSON, model: "fake-1" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      templateImpl: postmortemTemplate,
      signingKey: "test"
    });
    // The drafter prompt was the postmortem one (system message has the
    // signature phrase).
    expect(provider.calls[0].messages[0].content).toContain("incident-postmortem author");
    // Receipt records the postmortem template id (not pentest's).
    expect(result.receipt.template).toBe("postmortem@0.1.0");
    // The report's findings shape is unchanged (cvss N/A leaves severity alone).
    const finding = result.report.findings[0];
    expect(finding.severity).toBe("High");
    expect(finding.cvss).toBe("N/A");
    expect(finding.category).toBe("Root Cause");
  });
});

// Silence vi unused-import warning.
void vi;
