// ReportTemplate plugin interface.
//
// A "domain" in Verric = an Importer set + a ReportTemplate +
// (optionally) a DomainValidator. Pentest is the reference template;
// postmortem will be the second.
//
// The template owns:
//   - the drafter prompt (how to ask the LLM to write the report)
//   - the verifier prompt (independent grounding pass; the default
//     verifier is fine for most templates, override only if you have
//     domain-specific verdict rules)
//   - the deterministic post-LLM validator (CVSS recompute, control-id
//     match, etc.) — most templates can use the built-in validateReport
//
// runReport reads the template id but otherwise stays generic; new
// templates plug in without touching the orchestrator.

import { buildPentestPrompt, buildVerifierPrompt as buildDefaultVerifierPrompt } from "./prompts";
import type { BuiltPrompt, PentestPromptInput, VerifierClaimPayload } from "./prompts";
import { validateReport } from "./validate";
import type { EvidenceChunk, ProjectDetails, VerricReport } from "./types";

export interface ReportTemplate {
  /** Stable id, e.g. "pentest@0.1.0", "postmortem@0.1.0". Recorded in receipts. */
  readonly id: string;
  readonly displayName: string;

  /** Build the drafter prompt. */
  buildDrafterPrompt(input: PentestPromptInput): BuiltPrompt;

  /** Build the verifier prompt. Defaults to the generic claim-grounding verifier. */
  buildVerifierPrompt?(claims: VerifierClaimPayload[]): BuiltPrompt;

  /** Domain-specific deterministic validator. Defaults to validateReport. */
  validate?(report: VerricReport, chunks: EvidenceChunk[], project?: ProjectDetails): VerricReport;
}

/**
 * Pentest reference template — wraps the existing prompts + validator
 * into the new interface so pentest reports keep working unchanged.
 */
export const pentestTemplate: ReportTemplate = {
  id: "pentest@0.1.0",
  displayName: "Pentest report",
  buildDrafterPrompt: buildPentestPrompt,
  buildVerifierPrompt: buildDefaultVerifierPrompt,
  validate: validateReport
};
