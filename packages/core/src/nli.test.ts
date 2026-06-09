import { describe, expect, it } from "vitest";
import {
  blendConfidence,
  createProviderNliScorer,
  lexicalEntailmentScorer,
  type LLMProvider,
  type LLMResponse,
  type NliResult
} from "./index";

const nli = lexicalEntailmentScorer;

describe("lexicalEntailmentScorer", () => {
  it("scores high entailment when the claim is fully covered by the evidence", () => {
    const r = nli.score(
      "Nmap: 10.10.10.5 port 22/tcp open ssh — OpenSSH 7.2p2 Ubuntu",
      "The host exposes OpenSSH 7.2p2 on port 22."
    );
    expect(r.label).toBe("entailment");
    expect(r.entailment).toBeGreaterThan(0.6);
  });

  it("scores low entailment when the claim introduces content absent from the evidence", () => {
    const r = nli.score(
      "Nmap: 10.10.10.5 port 22/tcp open ssh",
      "The application is vulnerable to SQL injection allowing full database exfiltration."
    );
    expect(r.entailment).toBeLessThan(0.4);
    expect(r.label).not.toBe("entailment");
  });

  it("penalizes a fabricated number not present in the evidence", () => {
    const grounded = nli.score(
      "The admin panel returned HTTP 200 without authentication.",
      "The admin endpoint returned HTTP 200."
    );
    const fabricated = nli.score(
      "The admin panel returned HTTP 200 without authentication.",
      "The admin endpoint returned HTTP 503 for 4271 users."
    );
    // The fabricated figures (503, 4271) aren't in the premise → lower entailment.
    expect(fabricated.entailment).toBeLessThan(grounded.entailment);
  });

  it("flags contradiction when negation polarity flips on otherwise-covered text", () => {
    const r = nli.score(
      "The /admin endpoint required authentication and returned 401.",
      "The /admin endpoint did not require authentication."
    );
    // 'did not require' vs 'required' on shared content → contradiction signal.
    expect(r.contradiction).toBeGreaterThan(0);
  });

  it("returns neutral when there is no contentful overlap", () => {
    const r = nli.score(
      "Database backups run nightly at 02:00 UTC.",
      "The login page uses a red submit button."
    );
    expect(r.entailment).toBeLessThan(0.34);
  });

  it("handles empty premise / hypothesis without throwing", () => {
    expect(nli.score("", "anything").entailment).toBeLessThanOrEqual(0.34);
    expect(nli.score("anything", "").label).toBe("neutral");
  });

  it("always returns probabilities in [0,1]", () => {
    const r = nli.score("a b c d e", "a b c x y z 999");
    for (const k of ["entailment", "neutral", "contradiction", "score"] as const) {
      expect(r[k]).toBeGreaterThanOrEqual(0);
      expect(r[k]).toBeLessThanOrEqual(1);
    }
  });
});

describe("blendConfidence", () => {
  const strongEntail: NliResult = {
    label: "entailment",
    entailment: 0.95,
    neutral: 0.05,
    contradiction: 0,
    score: 0.95
  };
  const weakEntail: NliResult = {
    label: "neutral",
    entailment: 0.2,
    neutral: 0.7,
    contradiction: 0.1,
    score: 0.2
  };
  const contradiction: NliResult = {
    label: "contradiction",
    entailment: 0.1,
    neutral: 0.3,
    contradiction: 0.6,
    score: 0.1
  };

  it("a supported verdict backed by strong entailment stays high", () => {
    expect(blendConfidence("supported", strongEntail)).toBeGreaterThan(0.85);
  });

  it("a supported verdict with WEAK entailment is pulled down (catches over-confident verdicts)", () => {
    const c = blendConfidence("supported", weakEntail);
    expect(c).toBeLessThan(0.65);
    expect(c).toBeGreaterThan(0.4); // still reflects the 'supported' prior somewhat
  });

  it("strong contradiction caps confidence regardless of verdict", () => {
    expect(blendConfidence("supported", contradiction)).toBeLessThanOrEqual(0.3);
  });

  it("unsupported + low entailment stays low", () => {
    expect(blendConfidence("unsupported", weakEntail)).toBeLessThan(0.35);
  });

  it("is deterministic and rounded to 2 dp", () => {
    const a = blendConfidence("partial", strongEntail);
    const b = blendConfidence("partial", strongEntail);
    expect(a).toBe(b);
    expect(Number.isInteger(a * 100)).toBe(true);
  });
});

describe("createProviderNliScorer", () => {
  function fakeProvider(text: string): LLMProvider {
    return {
      id: "fake",
      model: "fake",
      async generate(): Promise<LLMResponse> {
        return { text, model: "fake" };
      }
    };
  }

  it("parses calibrated probabilities from the provider", async () => {
    const scorer = createProviderNliScorer(
      fakeProvider('{"entailment":0.8,"neutral":0.15,"contradiction":0.05}')
    );
    const r = await scorer.score("premise", "hypothesis");
    expect(r.entailment).toBeCloseTo(0.8, 5);
    expect(r.label).toBe("entailment");
  });

  it("falls back to neutral on unparseable output (never guesses)", async () => {
    const scorer = createProviderNliScorer(fakeProvider("not json"));
    const r = await scorer.score("premise", "hypothesis");
    expect(r.label).toBe("neutral");
  });
});
