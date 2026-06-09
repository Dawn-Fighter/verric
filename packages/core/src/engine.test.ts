import { describe, expect, it, vi } from "vitest";
import { runReport, VerricEngineError } from "./engine";
import type { LLMProvider, LLMRequest, LLMResponse } from "./providers";
import { emptyProjectDetails } from "./samples";
import type { EvidenceChunk, VerricReport } from "./types";

// Fake provider that returns a queue of responses (or throws on demand).
function fakeProvider(responses: Array<LLMResponse | Error>): LLMProvider & {
  calls: LLMRequest[];
} {
  const calls: LLMRequest[] = [];
  return {
    id: "fake",
    model: "fake-model",
    calls,
    async generate(req: LLMRequest): Promise<LLMResponse> {
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
    artifactId: "a",
    artifactName: "scan.txt",
    lineStart: 1,
    lineEnd: 1,
    text: "22/tcp open ssh"
  },
  {
    id: "ev-002",
    artifactId: "a",
    artifactName: "scan.txt",
    lineStart: 2,
    lineEnd: 2,
    text: "80/tcp open http"
  }
];

const MINIMAL_REPORT_JSON = JSON.stringify({
  project: emptyProjectDetails,
  overallRisk: "Medium",
  reportReadiness: "ready",
  readinessSummary: "ok",
  globalGaps: [],
  executiveSummary: [
    {
      id: "sum-001",
      text: "Scan revealed open SSH and HTTP services.",
      evidenceIds: ["ev-001", "ev-002"],
      status: "grounded"
    }
  ],
  keyRecommendations: [],
  methodology: ["OWASP WSTG"],
  findings: [
    {
      id: "VRC-001",
      title: "Service enumeration",
      severity: "Low",
      cvss: "3.7",
      cvssVector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N",
      affectedAssets: ["host"],
      status: "Ready for Report",
      category: "Information Disclosure",
      readiness: "ready",
      readinessSummary: "ok",
      gaps: [],
      description: [
        {
          id: "vrc-001-desc-001",
          text: "Two open services were identified.",
          evidenceIds: ["ev-001", "ev-002"],
          status: "grounded"
        }
      ],
      impact: [],
      proofOfConcept: [],
      remediation: [],
      references: ["CWE-200"]
    }
  ],
  remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
  flaggedClaims: []
});

const ALL_SUPPORTED_VERDICTS = JSON.stringify({
  verdicts: [
    { claimId: "sum-001", verdict: "supported" },
    { claimId: "vrc-001-desc-001", verdict: "supported" }
  ]
});

describe("runReport — happy path", () => {
  it("calls provider for drafter then verifier and returns a signed receipt", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake-1" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake-1" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      template: "pentest@test",
      signingKey: "test-key"
    });
    expect(provider.calls).toHaveLength(2);
    // Drafter prompt is JSON-mode and includes the canary chunk in the body.
    expect(provider.calls[0].jsonMode).toBe(true);
    expect(provider.calls[0].messages.some((m) => m.content.includes("ev-canary"))).toBe(true);
    // Receipt was signed.
    expect(result.receipt.algorithm).toBe("HMAC-SHA-256");
    expect(result.receipt.signature.length).toBeGreaterThan(0);
    expect(result.receipt.template).toBe("pentest@test");
    // Canary references are scrubbed from the final report.
    expect(JSON.stringify(result.report)).not.toContain("ev-canary");
    // CVSS recomputed from vector (3.7 / Low for that vector).
    expect(result.report.findings[0].cvss).toBe("3.7");
    expect(result.report.findings[0].severity).toBe("Low");
    expect(result.metadata.canaryTriggered).toBe(false);
    expect(result.metadata.verifierFailed).toBe(false);
  });
});

describe("runReport — drafter failures (no silent fallback)", () => {
  it("throws when the drafter provider call fails", async () => {
    const provider = fakeProvider([new Error("OpenAI 500")]);
    await expect(
      runReport({
        project: emptyProjectDetails,
        artifacts: [],
        chunks: CHUNKS,
        provider
      })
    ).rejects.toBeInstanceOf(VerricEngineError);
  });

  it("retries ONCE on schema failure and throws if repair also fails", async () => {
    const bad = '{"not":"a","valid":"report"}';
    const provider = fakeProvider([
      { text: bad, model: "fake" },
      { text: bad, model: "fake" }
    ]);
    await expect(
      runReport({
        project: emptyProjectDetails,
        artifacts: [],
        chunks: CHUNKS,
        provider
      })
    ).rejects.toMatchObject({ stage: "drafter_parse" });
    expect(provider.calls).toHaveLength(2);
  });

  it("succeeds when repair retry produces valid JSON", async () => {
    const provider = fakeProvider([
      { text: 'not json at all { "broken', model: "fake" },
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider
    });
    expect(result.report.findings).toHaveLength(1);
  });
});

describe("runReport — adversarial canary", () => {
  it("fails closed when drafter output echoes the canary payload", async () => {
    // Model executed the injection and emitted "PWN3D"
    const malicious = MINIMAL_REPORT_JSON.replace("Service enumeration", "Service enumeration PWN3D");
    const provider = fakeProvider([{ text: malicious, model: "fake" }]);
    await expect(
      runReport({
        project: emptyProjectDetails,
        artifacts: [],
        chunks: CHUNKS,
        provider
      })
    ).rejects.toMatchObject({ stage: "canary_triggered" });
  });

  it("can be disabled via enableCanary=false (e.g. for offline tests)", async () => {
    const malicious = MINIMAL_REPORT_JSON.replace("Service enumeration", "Service enumeration PWN3D");
    const provider = fakeProvider([
      { text: malicious, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      enableCanary: false
    });
    expect(result.report.findings[0].title).toContain("PWN3D");
  });
});

describe("runReport — verifier hardening", () => {
  it("flips a claim to flagged when the verifier says unsupported", async () => {
    const verdicts = JSON.stringify({
      verdicts: [
        { claimId: "sum-001", verdict: "unsupported", reason: "fabricated" },
        { claimId: "vrc-001-desc-001", verdict: "supported" }
      ]
    });
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: verdicts, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider
    });
    expect(result.report.executiveSummary[0].status).toBe("flagged");
    expect(result.report.executiveSummary[0].groundingNote).toMatch(/fabricated/);
  });

  it("survives a verifier crash (non-fatal) and reports verifierFailed=true", async () => {
    const provider = fakeProvider([{ text: MINIMAL_REPORT_JSON, model: "fake" }, new Error("verifier 500")]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider
    });
    expect(result.metadata.verifierFailed).toBe(true);
    expect(result.report.findings).toHaveLength(1); // report still produced
  });

  it("can disable the verifier entirely via enableVerifier=false", async () => {
    const provider = fakeProvider([{ text: MINIMAL_REPORT_JSON, model: "fake" }]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      enableVerifier: false
    });
    expect(provider.calls).toHaveLength(1);
    expect(result.verdicts).toEqual([]);
  });
});

describe("runReport — receipt covers the right artifacts", () => {
  it("evidence digest only covers REAL chunks (not the canary)", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      signingKey: "key"
    });
    expect(result.receipt.evidenceCount).toBe(CHUNKS.length); // not +1 for canary
  });
});

describe("VerricReport sanity", () => {
  // Spot-check that the type round-trips after the engine has run, so a
  // future refactor that breaks claim shape gets caught here too.
  it("produces a structurally valid VerricReport", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider
    });
    const report: VerricReport = result.report;
    expect(report.findings[0].description[0].evidenceIds).toEqual(["ev-001", "ev-002"]);
  });
});

describe("runReport — onProgress callback", () => {
  it("emits the full happy-path stage sequence", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const events: import("./engine").RunProgressEvent[] = [];
    await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      onProgress: (e) => events.push(e)
    });
    const stages = events.map((e) => e.stage);
    expect(stages).toEqual([
      "started",
      "drafting",
      "drafted",
      "parsing",
      "parsed",
      "validating",
      "validated",
      "verifying",
      "verified",
      "finalizing",
      "finalized"
    ]);
    // Timestamps are monotonically non-decreasing.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].elapsedMs).toBeGreaterThanOrEqual(events[i - 1].elapsedMs);
    }
    // Finalized event carries a receipt signature prefix.
    expect(events.at(-1)?.data?.receiptSignaturePrefix).toBeTruthy();
  });

  it("emits parse_repair when the first parse fails", async () => {
    const provider = fakeProvider([
      { text: 'not json at all { "broken', model: "fake" },
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const stages: string[] = [];
    await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      onProgress: (e) => stages.push(e.stage)
    });
    expect(stages).toContain("parse_repair");
    // parse_repair appears between parsing and parsed.
    const parseIdx = stages.indexOf("parsing");
    const repairIdx = stages.indexOf("parse_repair");
    const parsedIdx = stages.indexOf("parsed");
    expect(parseIdx).toBeLessThan(repairIdx);
    expect(repairIdx).toBeLessThan(parsedIdx);
  });

  it("does not throw when onProgress callback throws", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    // Observability hooks must not be able to break the engine.
    await expect(
      runReport({
        project: emptyProjectDetails,
        artifacts: [],
        chunks: CHUNKS,
        provider,
        onProgress: () => {
          throw new Error("observer blew up");
        }
      })
    ).resolves.toMatchObject({ report: expect.any(Object) });
  });

  it("emits a 'verified' event with verdictCount when the verifier ran", async () => {
    const provider = fakeProvider([
      { text: MINIMAL_REPORT_JSON, model: "fake" },
      { text: ALL_SUPPORTED_VERDICTS, model: "fake" }
    ]);
    const events: import("./engine").RunProgressEvent[] = [];
    await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: CHUNKS,
      provider,
      onProgress: (e) => events.push(e)
    });
    const verified = events.find((e) => e.stage === "verified");
    expect(verified).toBeTruthy();
    expect(verified?.data?.verdictCount).toBe(2);
  });
});

describe("runReport — NLI-blended confidence (end-to-end)", () => {
  // Two claims, BOTH rubber-stamped "supported" by the verifier. One is
  // genuinely covered by the evidence; the other is a fabrication. NLI
  // must pull the fabricated one's confidence down even though the
  // verdict is identical — that's the whole reason for a second signal.
  const GROUNDED_EV: EvidenceChunk[] = [
    {
      id: "ev-001",
      artifactId: "a",
      artifactName: "scan.txt",
      lineStart: 1,
      lineEnd: 1,
      text: "Nmap: 10.10.10.5 port 22/tcp open ssh — OpenSSH 7.2p2 Ubuntu"
    }
  ];

  const REPORT = JSON.stringify({
    project: emptyProjectDetails,
    overallRisk: "Medium",
    reportReadiness: "ready",
    readinessSummary: "ok",
    globalGaps: [],
    executiveSummary: [
      {
        id: "grounded-001",
        text: "The host exposes OpenSSH 7.2p2 on port 22.",
        evidenceIds: ["ev-001"],
        status: "grounded"
      },
      {
        id: "fabricated-001",
        text: "The database was exfiltrated and 50000 customer records were stolen.",
        evidenceIds: ["ev-001"],
        status: "grounded"
      }
    ],
    keyRecommendations: [],
    methodology: ["x"],
    findings: [],
    remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
    flaggedClaims: []
  });

  const BOTH_SUPPORTED = JSON.stringify({
    verdicts: [
      { claimId: "grounded-001", verdict: "supported" },
      { claimId: "fabricated-001", verdict: "supported" }
    ]
  });

  it("keeps a grounded supported claim high but pulls a fabricated supported claim down", async () => {
    const provider = fakeProvider([
      { text: REPORT, model: "fake" },
      { text: BOTH_SUPPORTED, model: "fake" }
    ]);
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: GROUNDED_EV,
      provider,
      enableCanary: false
    });
    const claims = result.report.executiveSummary;
    const grounded = claims.find((c) => c.id === "grounded-001");
    const fabricated = claims.find((c) => c.id === "fabricated-001");
    // Both got the same verdict, so both are status "grounded"…
    expect(grounded?.status).toBe("grounded");
    expect(fabricated?.status).toBe("grounded");
    // …but NLI separates them on confidence.
    expect(grounded?.confidence ?? 0).toBeGreaterThan(0.75);
    expect(fabricated?.confidence ?? 1).toBeLessThan(grounded?.confidence ?? 1);
    expect(fabricated?.confidence ?? 1).toBeLessThan(0.7);
  });

  it("accepts an injected NLI scorer (pluggable interface)", async () => {
    const provider = fakeProvider([
      { text: REPORT, model: "fake" },
      { text: BOTH_SUPPORTED, model: "fake" }
    ]);
    let calls = 0;
    const result = await runReport({
      project: emptyProjectDetails,
      artifacts: [],
      chunks: GROUNDED_EV,
      provider,
      enableCanary: false,
      nliScorer: {
        id: "always-1",
        score() {
          calls += 1;
          return { label: "entailment", entailment: 1, neutral: 0, contradiction: 0, score: 1 };
        }
      }
    });
    expect(calls).toBeGreaterThan(0); // the injected scorer was used
    // With entailment pinned to 1, every supported claim lands at the ceiling.
    for (const c of result.report.executiveSummary) {
      expect(c.confidence ?? 0).toBeGreaterThan(0.9);
    }
  });
});

// Silence vi's unused-import lint without a real ref.
void vi;
