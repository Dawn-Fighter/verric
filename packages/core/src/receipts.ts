// Cryptographic receipts for every Verric run.
//
// A receipt is a signed digest of {evidence, prompts, model, output,
// verdicts, timestamp}. Anyone with the run's signing key can verify
// later that a published report was produced from exactly that evidence
// by exactly that model — independent of the producer's good faith.
//
// Compliance/regulated-industry value: it converts "trust us" into
// "here is the signed proof."
//
// Implementation: HMAC-SHA-256 over a canonical JSON body. We keep the
// algorithm and the serialization deterministic so independent verifiers
// can recompute and compare.

import { createHash, createHmac, randomUUID } from "node:crypto";
import type { EvidenceChunk, VerricReport } from "./types";

export type GroundingVerdict = {
  claimId: string;
  verdict: "supported" | "partial" | "unsupported";
  reason?: string;
};

export interface ReceiptInput {
  /** Stable run identifier; one is generated if omitted. */
  runId?: string;
  /** Provider id ("openai", "anthropic", "ollama"). */
  providerId: string;
  /** Provider-reported model identifier (with versions, when available). */
  model: string;
  /** Template + version, e.g. "pentest@0.1.0". */
  template: string;
  /** Hashes of the system+user prompts the producer sent to the provider. */
  promptHashes: { drafter: string; verifier?: string };
  /** All evidence chunks the producer sent. */
  evidence: EvidenceChunk[];
  /** Final, validated report. */
  report: VerricReport;
  /** Verdicts produced by the independent grounding pass, if any. */
  verdicts?: GroundingVerdict[];
  /** ISO-8601 timestamp; one is generated if omitted. */
  timestamp?: string;
  /** HMAC signing key. Required to produce a verifiable receipt. */
  signingKey: string;
}

export interface Receipt {
  version: 1;
  runId: string;
  timestamp: string;
  providerId: string;
  model: string;
  template: string;
  digests: {
    evidence: string;
    drafterPrompt: string;
    verifierPrompt?: string;
    report: string;
    verdicts?: string;
  };
  evidenceCount: number;
  signature: string;
  algorithm: "HMAC-SHA-256";
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(key: string, body: string): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

/** Stable, deterministic JSON: keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function digestEvidence(chunks: EvidenceChunk[]): string {
  // Hash the canonical (sorted-by-id) chunk list so reordering doesn't
  // change the digest while reordering can't smuggle in different content.
  const sorted = [...chunks].sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalJson(sorted));
}

export function digestReport(report: VerricReport): string {
  return sha256(canonicalJson(report));
}

export function digestPrompt(prompt: { system: string; user: string }): string {
  return sha256(canonicalJson(prompt));
}

export function digestVerdicts(verdicts: GroundingVerdict[]): string {
  const sorted = [...verdicts].sort((a, b) => a.claimId.localeCompare(b.claimId));
  return sha256(canonicalJson(sorted));
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const runId = input.runId ?? randomUUID();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const evidenceDigest = digestEvidence(input.evidence);
  const reportDigest = digestReport(input.report);
  const verdictsDigest = input.verdicts ? digestVerdicts(input.verdicts) : undefined;

  const body = {
    version: 1 as const,
    runId,
    timestamp,
    providerId: input.providerId,
    model: input.model,
    template: input.template,
    digests: {
      evidence: evidenceDigest,
      drafterPrompt: input.promptHashes.drafter,
      ...(input.promptHashes.verifier ? { verifierPrompt: input.promptHashes.verifier } : {}),
      report: reportDigest,
      ...(verdictsDigest ? { verdicts: verdictsDigest } : {})
    },
    evidenceCount: input.evidence.length
  };

  const signature = hmacSha256(input.signingKey, canonicalJson(body));
  return {
    ...body,
    signature,
    algorithm: "HMAC-SHA-256"
  };
}

/**
 * Verify a receipt independently. Recomputes every digest from the
 * supplied artifacts and compares the signature. Returns an explanation
 * of any mismatch so a verifier knows exactly what changed.
 */
export interface VerifyInput {
  receipt: Receipt;
  signingKey: string;
  evidence: EvidenceChunk[];
  report: VerricReport;
  verdicts?: GroundingVerdict[];
}

export interface VerifyResult {
  ok: boolean;
  /** Per-field comparison; populated whether ok is true or false. */
  mismatches: string[];
}

export function verifyReceipt(input: VerifyInput): VerifyResult {
  const { receipt } = input;
  const mismatches: string[] = [];
  const evidenceDigest = digestEvidence(input.evidence);
  if (evidenceDigest !== receipt.digests.evidence) mismatches.push("evidence");
  const reportDigest = digestReport(input.report);
  if (reportDigest !== receipt.digests.report) mismatches.push("report");
  if (input.verdicts) {
    const expected = digestVerdicts(input.verdicts);
    if (expected !== (receipt.digests.verdicts ?? "")) mismatches.push("verdicts");
  }
  // Recompute signature from the receipt body (everything except signature/algorithm)
  const { signature: _sig, algorithm: _alg, ...body } = receipt;
  const expectedSignature = hmacSha256(input.signingKey, canonicalJson(body));
  if (expectedSignature !== receipt.signature) mismatches.push("signature");
  return { ok: mismatches.length === 0, mismatches };
}
