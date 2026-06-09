// runReport — the production orchestrator.
//
// Real provider or honest failure. No mock fallback. The pipeline:
//
//   1. Inject an adversarial canary chunk into the evidence sent to the
//      drafter so a successful prompt-injection becomes detectable.
//   2. Build the drafter prompt with structurally delimited untrusted
//      evidence and call the provider in JSON mode.
//   3. parseReportJson; if schema-invalid, ONE repair retry that hands
//      the model the validation issues.
//   4. Run validateReport (deterministic CVSS recompute, evidence-ID
//      scrub, defaults, normalization).
//   5. Strip the canary chunk from anything that ends up in outputs.
//   6. Run the independent grounding pass with a hardened verifier
//      prompt; tolerate verifier failures (don't fail the whole run for
//      a verifier hiccup), but record the absence of verdicts.
//   7. Build a cryptographic receipt over evidence + prompts + report.
//
// Failures at steps 1-3 throw. Failures at the verifier step are
// non-fatal (the run still produces a report, but with no verdicts and
// a flag in metadata).
//
// The optional `onProgress` callback is invoked at each stage so callers
// (CLI, async worker, tests) can surface real progress to the user. It
// is fire-and-forget — the engine doesn't await it. Callers that need
// to persist events should do so synchronously inside the callback;
// SQLite/in-memory writes are fast enough that this isn't a bottleneck.

import { extractJson } from "./json";
import {
  INJECTION_CANARY,
  buildVerifierPrompt,
  collectVerifiableClaims,
  injectionCanaryChunk
} from "./prompts";
import type { LLMProvider } from "./providers";
import { type GroundingVerdict, type Receipt, buildReceipt, digestPrompt } from "./receipts";
import { parseReportJson } from "./schema";
import { pentestTemplate } from "./templates";
import type { ReportTemplate } from "./templates";
import { blendConfidence, lexicalEntailmentScorer, type NliScorer } from "./nli";
import type { EvidenceArtifact, EvidenceChunk, ProjectDetails, ReportClaim, VerricReport } from "./types";
import { validateReport } from "./validate";

export class VerricEngineError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "drafter_call"
      | "drafter_parse"
      | "drafter_repair"
      | "canary_triggered"
      | "validation",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "VerricEngineError";
  }
}

/**
 * Stages emitted via `onProgress`. They form a (mostly) linear timeline,
 * though terminal failures can short-circuit anywhere.
 */
export type RunProgressStage =
  | "started" //   engine entry
  | "drafting" //   about to call drafter provider
  | "drafted" //   drafter response in hand
  | "parsing" //   first JSON parse / schema validation
  | "parse_repair" // first parse failed; retrying
  | "parsed" //   parsed + schema-valid
  | "validating" // running deterministic validateReport
  | "validated" //   validated; canary scrub applied
  | "verifying" //   about to call grounding verifier
  | "verified" //   verifier returned verdicts (or was skipped)
  | "finalizing" // building receipt
  | "finalized"; //   receipt built; result ready

export interface RunProgressEvent {
  stage: RunProgressStage;
  message: string;
  /** Wall-clock ms since runReport started. */
  elapsedMs: number;
  /** Optional structured payload — model id, token usage, claim count, etc. */
  data?: Record<string, unknown>;
}

export interface RunReportInput {
  project: ProjectDetails;
  artifacts: EvidenceArtifact[];
  chunks: EvidenceChunk[];
  provider: LLMProvider;
  /**
   * Template ID for receipts. Defaults to "pentest@0.1.0". When you
   * pass `templateImpl`, this is ignored — the impl's id is used.
   */
  template?: string;
  /**
   * Plug-in template implementation. When provided, supersedes the
   * `template` string and is used for prompt + verifier + validator.
   * Defaults to the pentest reference template.
   */
  templateImpl?: ReportTemplate;
  /** HMAC key for receipt signatures. Falls back to a non-secret default for unsigned receipts. */
  signingKey?: string;
  /** Disable the canary injection check. Default: enabled. */
  enableCanary?: boolean;
  /** Disable the second-pass grounding verifier. Default: enabled. */
  enableVerifier?: boolean;
  /**
   * NLI scorer used to compute per-claim confidence from the cited
   * evidence. Defaults to the deterministic lexical-entailment scorer.
   * Inject a transformer- or provider-backed scorer for stronger signal.
   */
  nliScorer?: NliScorer;
  /**
   * Optional progress hook. Called synchronously at each stage so the
   * caller can persist events / push them over SSE / write structured
   * logs. Errors in the callback are caught and ignored — observability
   * shouldn't be able to break the engine.
   */
  onProgress?: (event: RunProgressEvent) => void;
}

export interface RunReportResult {
  report: VerricReport;
  receipt: Receipt;
  verdicts: GroundingVerdict[];
  /** Provider id + provider-reported model + usage, for display + metrics. */
  metadata: {
    providerId: string;
    drafterModel: string;
    verifierModel?: string;
    drafterUsage?: { inputTokens?: number; outputTokens?: number };
    verifierUsage?: { inputTokens?: number; outputTokens?: number };
    canaryTriggered: boolean;
    verifierFailed: boolean;
    durationMs: number;
  };
}

export async function runReport(input: RunReportInput): Promise<RunReportResult> {
  const start = Date.now();
  const enableCanary = input.enableCanary ?? true;
  const enableVerifier = input.enableVerifier ?? true;
  const templateImpl: ReportTemplate = input.templateImpl ?? pentestTemplate;
  const nliScorer: NliScorer = input.nliScorer ?? lexicalEntailmentScorer;
  const templateId = input.templateImpl ? input.templateImpl.id : (input.template ?? templateImpl.id);
  const signingKey = input.signingKey ?? "verric-unsigned";

  const emit = (stage: RunProgressStage, message: string, data?: Record<string, unknown>) => {
    if (!input.onProgress) return;
    try {
      input.onProgress({ stage, message, elapsedMs: Date.now() - start, data });
    } catch {
      // observability hook errors are intentionally swallowed
    }
  };

  emit("started", "Engine starting", {
    providerId: input.provider.id,
    template: templateId,
    chunkCount: input.chunks.length,
    artifactCount: input.artifacts.length,
    enableCanary,
    enableVerifier
  });

  // 1. Build evidence with canary chunk (if enabled). The canary is included
  //    in the prompt but stripped from receipts/output.
  const promptChunks = enableCanary ? [...input.chunks, injectionCanaryChunk()] : input.chunks;

  // 2. Drafter prompt + call.
  const drafterPrompt = templateImpl.buildDrafterPrompt({
    project: input.project,
    chunks: promptChunks,
    artifacts: input.artifacts
  });

  emit("drafting", `Calling ${input.provider.id} drafter`, {
    providerId: input.provider.id
  });

  let drafterResp;
  try {
    drafterResp = await input.provider.generate({
      messages: [
        { role: "system", content: drafterPrompt.system },
        { role: "user", content: drafterPrompt.user }
      ],
      temperature: 0.15,
      maxTokens: 5200,
      jsonMode: true
    });
  } catch (err) {
    throw new VerricEngineError(
      `Drafter provider call failed: ${(err as Error).message}`,
      "drafter_call",
      err
    );
  }

  emit("drafted", "Drafter response received", {
    model: drafterResp.model,
    usage: drafterResp.usage
  });

  // Canary check: if the model echoed the canary marker or its payload,
  // the run was attacked (or the model is insufficiently aligned). Fail closed.
  if (enableCanary && containsCanaryEcho(drafterResp.text)) {
    throw new VerricEngineError(
      "Adversarial canary triggered: drafter output echoed an injection sentinel.",
      "canary_triggered"
    );
  }

  // 3. Parse the JSON. One repair retry on schema failure.
  emit("parsing", "Parsing + schema-validating drafter output");
  let parsed = parseReportJson(extractJson(drafterResp.text));
  if (!parsed.ok) {
    emit("parse_repair", "Schema invalid; attempting one repair retry", {
      error: parsed.error
    });
    const repairPrompt = `The previous JSON failed validation: ${parsed.error}. Issues: ${JSON.stringify(parsed.issues).slice(0, 1500)}. Reply with ONLY a corrected JSON document. Do not add prose.`;
    let repairResp;
    try {
      repairResp = await input.provider.generate({
        messages: [
          { role: "system", content: drafterPrompt.system },
          { role: "user", content: drafterPrompt.user },
          { role: "assistant", content: drafterResp.text },
          { role: "user", content: repairPrompt }
        ],
        temperature: 0,
        maxTokens: 5200,
        jsonMode: true
      });
    } catch (err) {
      throw new VerricEngineError(
        `Drafter repair call failed: ${(err as Error).message}`,
        "drafter_repair",
        err
      );
    }
    parsed = parseReportJson(extractJson(repairResp.text));
    if (!parsed.ok) {
      throw new VerricEngineError(
        `Drafter output is not valid JSON after repair retry: ${parsed.error}`,
        "drafter_parse",
        parsed.issues
      );
    }
  }
  emit("parsed", "Schema validation passed", {
    findingCount: parsed.report.findings.length,
    flaggedCount: parsed.report.flaggedClaims.length
  });

  // 4. Deterministic post-LLM validation (CVSS recompute, ID scrub vs the
  //    REAL chunks — note: NOT the canary-augmented set, so a model that
  //    cited the canary will have those references stripped here too).
  emit("validating", "Recomputing CVSS, scrubbing invalid evidence IDs");
  let report: VerricReport;
  try {
    const validator = templateImpl.validate ?? validateReport;
    report = validator(parsed.report, input.chunks, input.project);
  } catch (err) {
    throw new VerricEngineError(`validateReport failed: ${(err as Error).message}`, "validation", err);
  }

  // 5. Strip any references to the canary from claim/flagged outputs
  //    just in case the model echoed it but didn't emit the payload.
  report = stripCanaryReferences(report);
  emit("validated", "Validation complete", {
    findingCount: report.findings.length,
    overallRisk: report.overallRisk
  });

  // 6. Independent grounding pass — best effort, non-fatal.
  let verdicts: GroundingVerdict[] = [];
  let verifierPromptHash: string | undefined;
  let verifierModel: string | undefined;
  let verifierUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  let verifierFailed = false;

  if (enableVerifier) {
    const verifiable = collectVerifiableClaims(report);
    if (verifiable.length > 0) {
      emit("verifying", `Independent grounding pass over ${verifiable.length} claims`, {
        claimCount: verifiable.length
      });
      const chunkLookup = new Map(input.chunks.map((c) => [c.id, c]));
      const payload = verifiable.map((claim) => ({
        claimId: claim.id,
        text: claim.text,
        evidence: claim.evidenceIds
          .map((id) => {
            const c = chunkLookup.get(id);
            return c ? `${c.id}: ${c.text.slice(0, 400)}` : null;
          })
          .filter((s): s is string => Boolean(s))
      }));
      const verifierPrompt = (templateImpl.buildVerifierPrompt ?? buildVerifierPrompt)(payload);
      verifierPromptHash = digestPrompt(verifierPrompt);
      try {
        const verifierResp = await input.provider.generate({
          messages: [
            { role: "system", content: verifierPrompt.system },
            { role: "user", content: verifierPrompt.user }
          ],
          temperature: 0,
          maxTokens: 1800,
          jsonMode: true
        });
        verifierModel = verifierResp.model;
        verifierUsage = verifierResp.usage;

        // Canary check on verifier too — a verifier that gets injected is
        // catastrophic: it would rubber-stamp unsupported claims.
        if (enableCanary && containsCanaryEcho(verifierResp.text)) {
          throw new VerricEngineError(
            "Adversarial canary triggered: verifier output echoed an injection sentinel.",
            "canary_triggered"
          );
        }

        const verdictParsed = JSON.parse(extractJson(verifierResp.text)) as {
          verdicts?: GroundingVerdict[];
        };
        if (Array.isArray(verdictParsed.verdicts)) {
          verdicts = verdictParsed.verdicts;
          report = await applyVerdicts(report, verdicts, input.chunks, nliScorer);
        }
        emit("verified", `Verifier returned ${verdicts.length} verdicts`, {
          verdictCount: verdicts.length,
          model: verifierModel,
          usage: verifierUsage
        });
      } catch (err) {
        // Verifier failures are non-fatal: we still ship the validated
        // report, but mark verifierFailed in metadata so callers can
        // surface a UI hint that a re-run is recommended.
        if (err instanceof VerricEngineError && err.stage === "canary_triggered") {
          throw err;
        }
        verifierFailed = true;
        emit("verified", `Verifier failed (non-fatal); shipping unverified report`, {
          error: (err as Error).message
        });
      }
    } else {
      emit("verified", "No verifiable claims; skipping grounding pass");
    }
  } else {
    emit("verified", "Verifier disabled by caller");
  }

  // 7. Build the receipt over the FINAL report + the REAL evidence (no canary).
  emit("finalizing", "Signing cryptographic receipt");
  const drafterPromptHash = digestPrompt(drafterPrompt);
  const receipt = buildReceipt({
    providerId: input.provider.id,
    model: drafterResp.model,
    template: templateId,
    promptHashes: { drafter: drafterPromptHash, verifier: verifierPromptHash },
    evidence: input.chunks,
    report,
    verdicts: verdicts.length > 0 ? verdicts : undefined,
    signingKey
  });
  emit("finalized", "Run complete", {
    durationMs: Date.now() - start,
    receiptSignaturePrefix: receipt.signature.slice(0, 12)
  });

  return {
    report,
    receipt,
    verdicts,
    metadata: {
      providerId: input.provider.id,
      drafterModel: drafterResp.model,
      verifierModel,
      drafterUsage: drafterResp.usage,
      verifierUsage,
      canaryTriggered: false,
      verifierFailed,
      durationMs: Date.now() - start
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Editor support — single-claim re-grounding
// ─────────────────────────────────────────────────────────────────────────

export interface GroundClaimInput {
  /** The single claim to ground. Its evidenceIds must reference real chunks. */
  claim: ReportClaim;
  /** All chunks for the run (so the claim's evidenceIds can be looked up). */
  chunks: EvidenceChunk[];
  provider: LLMProvider;
  /** Optional template for a domain-specific verifier prompt. */
  templateImpl?: ReportTemplate;
  /** Disable the canary check on the verifier. Default: enabled. */
  enableCanary?: boolean;
  /** NLI scorer for confidence. Defaults to the lexical-entailment scorer. */
  nliScorer?: NliScorer;
}

export interface GroundClaimResult {
  /** The same claim with its status + groundingNote updated. */
  claim: ReportClaim;
  /** Raw verdict from the verifier. */
  verdict: GroundingVerdict;
  /** Verifier model + usage for metadata/receipts. */
  metadata: {
    providerId: string;
    model: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    durationMs: number;
  };
}

/**
 * Re-ground a single edited claim. Used by the editor:
 *   user edits text / evidence → server calls groundClaim → status flips
 *   to grounded / needs_review / flagged based on the verifier verdict.
 *
 * Designed to be cheap (one provider call) so the UI can show fresh
 * verdicts within a couple of seconds.
 */
export async function groundClaim(input: GroundClaimInput): Promise<GroundClaimResult> {
  const start = Date.now();
  const enableCanary = input.enableCanary ?? true;
  const templateImpl = input.templateImpl ?? pentestTemplate;
  const nliScorer = input.nliScorer ?? lexicalEntailmentScorer;

  const chunkLookup = new Map(input.chunks.map((c) => [c.id, c]));
  const evidence = input.claim.evidenceIds
    .map((id) => {
      const c = chunkLookup.get(id);
      return c ? `${c.id}: ${c.text.slice(0, 400)}` : null;
    })
    .filter((s): s is string => Boolean(s));

  const verifierPrompt = (templateImpl.buildVerifierPrompt ?? buildVerifierPrompt)([
    {
      claimId: input.claim.id,
      text: input.claim.text,
      evidence
    }
  ]);

  const resp = await input.provider.generate({
    messages: [
      { role: "system", content: verifierPrompt.system },
      { role: "user", content: verifierPrompt.user }
    ],
    temperature: 0,
    maxTokens: 600,
    jsonMode: true
  });

  if (enableCanary && (resp.text.includes(INJECTION_CANARY) || /\bPWN3D\b/.test(resp.text))) {
    throw new VerricEngineError(
      "Adversarial canary triggered: verifier output echoed an injection sentinel.",
      "canary_triggered"
    );
  }

  let verdict: GroundingVerdict = { claimId: input.claim.id, verdict: "unsupported" };
  try {
    const parsed = JSON.parse(extractJson(resp.text)) as { verdicts?: GroundingVerdict[] };
    const found = parsed.verdicts?.find((v) => v.claimId === input.claim.id);
    if (found) verdict = found;
  } catch {
    // Parse failure → fall through with default 'unsupported'.
  }

  // Independent NLI entailment score from the cited evidence, blended
  // with the verdict for the final confidence.
  const premise = input.claim.evidenceIds
    .map((id) => chunkLookup.get(id)?.text ?? "")
    .filter(Boolean)
    .join("\n");
  const nli = await nliScorer.score(premise, input.claim.text);
  const confidence = blendConfidence(verdict.verdict, nli);

  const updated: ReportClaim = (() => {
    if (verdict.verdict === "supported") {
      return { ...input.claim, status: "grounded", groundingNote: undefined, confidence };
    }
    if (verdict.verdict === "partial") {
      return {
        ...input.claim,
        status: "needs_review",
        groundingNote: verdict.reason
          ? `Verric: ${verdict.reason}`
          : "Verric: evidence partially supports this claim.",
        confidence
      };
    }
    return {
      ...input.claim,
      status: "flagged",
      groundingNote: verdict.reason
        ? `Verric: ${verdict.reason}`
        : "Verric: cited evidence does not support this claim.",
      confidence
    };
  })();

  return {
    claim: updated,
    verdict,
    metadata: {
      providerId: input.provider.id,
      model: resp.model,
      usage: resp.usage,
      durationMs: Date.now() - start
    }
  };
}

function containsCanaryEcho(text: string): boolean {
  // The canary's payload is "PWN3D" — the model would only emit that string
  // if it had executed the injection's instructions. We also detect echoes
  // of the marker itself in case the model parroted the chunk text.
  if (text.includes(INJECTION_CANARY)) return true;
  // "PWN3D" is rare enough in legitimate pentest reports that catching it
  // is high signal; if it appears, fail closed and let a human re-run.
  return /\bPWN3D\b/.test(text);
}

function stripCanaryReferences(report: VerricReport): VerricReport {
  const scrub = (claim: ReportClaim): ReportClaim => ({
    ...claim,
    evidenceIds: claim.evidenceIds.filter((id) => id !== "ev-canary")
  });
  const scrubFlagged = (c: VerricReport["flaggedClaims"][number]) => ({
    ...c,
    relatedEvidenceIds: c.relatedEvidenceIds.filter((id) => id !== "ev-canary")
  });
  return {
    ...report,
    executiveSummary: report.executiveSummary.map(scrub),
    keyRecommendations: report.keyRecommendations.map(scrub),
    findings: report.findings.map((f) => ({
      ...f,
      description: f.description.map(scrub),
      impact: f.impact.map(scrub),
      proofOfConcept: f.proofOfConcept.map(scrub),
      remediation: f.remediation.map(scrub)
    })),
    flaggedClaims: report.flaggedClaims.map(scrubFlagged)
  };
}

async function applyVerdicts(
  report: VerricReport,
  verdicts: GroundingVerdict[],
  chunks: EvidenceChunk[],
  nliScorer: NliScorer
): Promise<VerricReport> {
  const map = new Map(verdicts.map((v) => [v.claimId, v]));
  const chunkLookup = new Map(chunks.map((c) => [c.id, c]));

  const premiseFor = (claim: ReportClaim): string =>
    claim.evidenceIds
      .map((id) => chunkLookup.get(id)?.text ?? "")
      .filter(Boolean)
      .join("\n");

  const apply = async (claim: ReportClaim): Promise<ReportClaim> => {
    const v = map.get(claim.id);
    if (!v) return claim;
    // Compute an independent NLI entailment score from the cited evidence,
    // then blend it with the verdict for the final confidence.
    const nli = await nliScorer.score(premiseFor(claim), claim.text);
    const confidence = blendConfidence(v.verdict, nli);
    if (v.verdict === "supported") {
      return { ...claim, status: "grounded", groundingNote: undefined, confidence };
    }
    if (v.verdict === "partial") {
      return {
        ...claim,
        status: "needs_review",
        groundingNote: v.reason ? `Verric: ${v.reason}` : "Verric: evidence partially supports this claim.",
        confidence
      };
    }
    return {
      ...claim,
      status: "flagged",
      groundingNote: v.reason ? `Verric: ${v.reason}` : "Verric: cited evidence does not support this claim.",
      confidence
    };
  };

  const applyList = (list: ReportClaim[]) => Promise.all(list.map(apply));

  return {
    ...report,
    executiveSummary: await applyList(report.executiveSummary),
    findings: await Promise.all(
      report.findings.map(async (f) => ({
        ...f,
        description: await applyList(f.description),
        impact: await applyList(f.impact),
        proofOfConcept: await applyList(f.proofOfConcept),
        remediation: await applyList(f.remediation)
      }))
    )
  };
}
