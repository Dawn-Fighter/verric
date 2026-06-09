// NLI (Natural Language Inference) entailment scoring.
//
// Replaces the verdict-only confidence heuristic with a *computed*
// entailment signal: given a premise (the cited evidence text) and a
// hypothesis (the claim), produce P(entailment / neutral / contradiction).
//
// Why this exists: the LLM grounding verifier gives a coarse 3-way
// verdict. NLI adds an INDEPENDENT, deterministic measurement of how
// much of the claim is actually supported by the evidence text — so a
// claim the verifier rubber-stamps "supported" but whose words aren't
// in the evidence gets a lower confidence. That's the whole point of a
// second signal: it catches over-confident verdicts.
//
// The default `lexicalEntailmentScorer` is a classic lexical-overlap NLI
// baseline (the same family of model used as the baseline in the
// SNLI/MNLI literature): content-word coverage + negation detection +
// numeric-consistency. It's zero-dependency, deterministic, fast, and
// local-first — no model download, runs in Node and the browser.
//
// `NliScorer` is an interface, so a transformer-backed scorer
// (cross-encoder NLI via transformers.js/ONNX) or a provider-backed
// scorer can drop in without touching the engine. A provider-backed
// implementation is included below.

import type { LLMProvider } from "./providers";
import { extractJson } from "./json";

export type NliLabel = "entailment" | "neutral" | "contradiction";

export interface NliResult {
  label: NliLabel;
  /** P(premise entails hypothesis) in [0,1]. */
  entailment: number;
  /** P(neither entails nor contradicts) in [0,1]. */
  neutral: number;
  /** P(premise contradicts hypothesis) in [0,1]. */
  contradiction: number;
  /** Convenience: the support score used for confidence (= entailment). */
  score: number;
}

export interface NliScorer {
  readonly id: string;
  /** Score whether `premise` entails `hypothesis`. May be sync or async. */
  score(premise: string, hypothesis: string): NliResult | Promise<NliResult>;
}

// ─────────────────────────────────────────────────────────────────────────
// Lexical-entailment scorer (default)
// ─────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "as",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "which",
  "who",
  "whom",
  "whose",
  "what",
  "when",
  "where",
  "why",
  "how",
  "can",
  "could",
  "may",
  "might",
  "will",
  "would",
  "should",
  "shall",
  "must",
  "do",
  "does",
  "did",
  "has",
  "have",
  "had",
  "than",
  "then",
  "so",
  "if",
  "into",
  "over",
  "under",
  "via",
  "per",
  "about",
  "their",
  "there"
]);

const NEGATIONS = new Set([
  "no",
  "not",
  "never",
  "none",
  "without",
  "cannot",
  "n't",
  "neither",
  "nor",
  "fails",
  "failed",
  "unable",
  "absent",
  "missing",
  "lacks",
  "lacking",
  "denied",
  "blocked"
]);

function normalizeTokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Keep letters, digits, dots and hyphens (for IPs / versions / decimals
      // like 10.10.10.5 and 7.2p2); turn everything else — including "/" and
      // ":" so "22/tcp" → "22 tcp" and "nmap:" → "nmap" — into spaces.
      .replace(/[^a-z0-9.\-\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.replace(/^[-.]+|[-.]+$/g, "")) // trim stray leading/trailing . or -
      .filter(Boolean)
  );
}

/** Crude but deterministic stem: drop a few common suffixes for matching. */
function stem(token: string): string {
  return token
    .replace(/(ing|edly|edness)$/, "")
    .replace(/(ed|es|s)$/, "")
    .replace(/(ly)$/, "");
}

function contentWords(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (NEGATIONS.has(t)) continue;
    out.add(stem(t));
  }
  return out;
}

/** Extract numbers + version-ish tokens (e.g. 200, 8080, 7.2p2, 1.20). */
function extractNumerics(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    if (/\d/.test(t)) out.add(t.replace(/[.:-]+$/, ""));
  }
  return out;
}

function countNegations(tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (NEGATIONS.has(t) || t.endsWith("n't")) n += 1;
  return n;
}

/**
 * Lexical-entailment scorer. Deterministic, zero-dependency.
 *
 * Signals:
 *  - coverage: fraction of the claim's content words present in the evidence
 *  - numericConsistency: numbers/versions in the claim must appear in the
 *    evidence, else we suspect a fabricated figure (penalty)
 *  - negationMismatch: a negation present on one side but not the other
 *    flips support toward contradiction
 */
export const lexicalEntailmentScorer = {
  id: "lexical",
  score(premise: string, hypothesis: string): NliResult {
    const pTok = normalizeTokens(premise);
    const hTok = normalizeTokens(hypothesis);
    const pWords = contentWords(pTok);
    const hWords = contentWords(hTok);

    if (hWords.size === 0) {
      // Nothing contentful to check — neutral.
      return { label: "neutral", entailment: 0.34, neutral: 0.5, contradiction: 0.16, score: 0.34 };
    }
    if (pWords.size === 0) {
      // No premise content — can't support anything.
      return { label: "neutral", entailment: 0.15, neutral: 0.7, contradiction: 0.15, score: 0.15 };
    }

    // Coverage of the hypothesis by the premise.
    let covered = 0;
    for (const w of Array.from(hWords)) if (pWords.has(w)) covered += 1;
    const coverage = covered / hWords.size;

    // Numeric consistency: any claim number absent from the premise is suspicious.
    const hNums = extractNumerics(hTok);
    const pNums = extractNumerics(pTok);
    let numericPenalty = 0;
    if (hNums.size > 0) {
      let missing = 0;
      for (const n of Array.from(hNums)) if (!pNums.has(n)) missing += 1;
      numericPenalty = missing / hNums.size; // 0..1
    }

    // Negation mismatch: different negation polarity ⇒ contradiction signal.
    const pNeg = countNegations(pTok);
    const hNeg = countNegations(hTok);
    const negMismatch = (pNeg === 0) !== (hNeg === 0) && coverage > 0.4;

    // Compose pseudo-probabilities.
    let entailment = coverage * (1 - 0.6 * numericPenalty);
    let contradiction = 0;
    if (negMismatch) {
      contradiction = Math.min(0.7, 0.3 + coverage * 0.4);
      entailment *= 0.4;
    }
    if (numericPenalty > 0) {
      contradiction = Math.max(contradiction, 0.25 * numericPenalty);
    }
    entailment = clamp01(entailment);
    contradiction = clamp01(contradiction);
    const neutral = clamp01(1 - entailment - contradiction);

    const label: NliLabel =
      entailment >= neutral && entailment >= contradiction
        ? "entailment"
        : contradiction >= neutral
          ? "contradiction"
          : "neutral";

    return { label, entailment, neutral, contradiction, score: entailment };
  }
} satisfies NliScorer;

// ─────────────────────────────────────────────────────────────────────────
// Provider-backed scorer (optional)
// ─────────────────────────────────────────────────────────────────────────

/**
 * NLI via an LLMProvider asked for calibrated entailment probabilities.
 * Useful when you'd rather spend a model call than rely on lexical
 * overlap. Still independent of the grounding *verdict* prompt — it asks
 * a narrow, single-purpose NLI question.
 */
export function createProviderNliScorer(provider: LLMProvider): NliScorer {
  return {
    id: `provider:${provider.id}`,
    async score(premise: string, hypothesis: string): Promise<NliResult> {
      const resp = await provider.generate({
        messages: [
          {
            role: "system",
            content:
              "You are a natural-language-inference classifier. Given a PREMISE and a HYPOTHESIS, return ONLY JSON with calibrated probabilities that the premise entails / is neutral to / contradicts the hypothesis. They must sum to ~1."
          },
          {
            role: "user",
            content: `PREMISE:\n${premise.slice(0, 2000)}\n\nHYPOTHESIS:\n${hypothesis.slice(0, 1000)}\n\nReturn: {"entailment":0..1,"neutral":0..1,"contradiction":0..1}`
          }
        ],
        temperature: 0,
        maxTokens: 120,
        jsonMode: true
      });
      try {
        const parsed = JSON.parse(extractJson(resp.text)) as Partial<NliResult>;
        const e = clamp01(Number(parsed.entailment ?? 0));
        const c = clamp01(Number(parsed.contradiction ?? 0));
        const n = clamp01(Number(parsed.neutral ?? Math.max(0, 1 - e - c)));
        const label: NliLabel = e >= n && e >= c ? "entailment" : c >= n ? "contradiction" : "neutral";
        return { label, entailment: e, neutral: n, contradiction: c, score: e };
      } catch {
        // On parse failure, defer to a neutral result rather than guessing.
        return { label: "neutral", entailment: 0.5, neutral: 0.5, contradiction: 0, score: 0.5 };
      }
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Confidence blending
// ─────────────────────────────────────────────────────────────────────────

const VERDICT_PRIOR: Record<"supported" | "partial" | "unsupported", number> = {
  supported: 0.9,
  partial: 0.5,
  unsupported: 0.1
};

/**
 * Blend the LLM verdict (semantic judgment) with the NLI entailment score
 * (independent lexical-grounding measurement) into a single confidence.
 *
 * The blend means: a "supported" verdict whose claim text isn't actually
 * grounded in the evidence is pulled DOWN; a "supported" claim well
 * covered by evidence stays high. Contradiction evidence pulls hard down.
 */
export function blendConfidence(verdict: "supported" | "partial" | "unsupported", nli: NliResult): number {
  const prior = VERDICT_PRIOR[verdict];
  let blended = 0.55 * prior + 0.45 * nli.entailment;
  // Strong contradiction signal caps confidence regardless of verdict.
  if (nli.label === "contradiction" && nli.contradiction >= 0.4) {
    blended = Math.min(blended, 0.3);
  }
  return Math.round(clamp01(blended) * 100) / 100;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
