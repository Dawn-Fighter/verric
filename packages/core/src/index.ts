// Public surface of @verric/core.
//
// Pure-TypeScript engine: no React, no Next, no Node-only deps in the data
// model. (Receipts use node:crypto — that's fine for self-host servers and
// CLIs. Browser builds that need receipts can swap in a Web Crypto layer.)
// Anything that depends on a runtime (server frameworks, FS, framework
// fetch APIs) belongs in the consuming app — not here.

// Types
export type {
  Severity,
  ProjectDetails,
  EvidenceKind,
  EvidenceArtifact,
  EvidenceChunk,
  ClaimStatus,
  ReportClaim,
  EvidenceGap,
  ReadinessStatus,
  FlaggedClaim,
  Finding,
  VerricReport
} from "./types";

// CVSS 3.1 base score (the deterministic core)
export { cvssFromVector, severityFromScore } from "./cvss";

// Importer prototype: nmap parser
export { isNmapContent, parseNmap } from "./nmap";
export type { NmapHost, NmapPort } from "./nmap";

// Pluggable importer framework — Burp / Nessus / Nuclei / ZAP / OpenVAS
// + the legacy nmap importer all conform to this.
export {
  ImporterRegistry,
  defaultImporterRegistry,
  formatChunkId,
  burpImporter,
  nessusImporter,
  nucleiImporter,
  nmapImporter,
  openvasImporter,
  zapImporter
} from "./importers";
export type { Importer, ImporterContext } from "./importers";

// Report template framework
export { pentestTemplate } from "./templates";
export type { ReportTemplate } from "./templates";
export { postmortemTemplate, buildPostmortemPrompt } from "./templates-postmortem";
export { adrTemplate, buildAdrPrompt } from "./templates-adr";

// NLI entailment scoring (computes claim confidence from cited evidence)
export { lexicalEntailmentScorer, createProviderNliScorer, blendConfidence } from "./nli";
export type { NliScorer, NliResult, NliLabel } from "./nli";

// Evidence chunking
export { buildEvidenceChunks, chunkEvidence, inferEvidenceKind } from "./chunks";

// LLM JSON normalization
export { extractJson } from "./json";

// Schema-validated parsing of LLM output
export {
  parseReportJson,
  VerricReportSchema,
  VerricReportLooseSchema,
  ProjectDetailsSchema,
  ReportClaimSchema,
  FindingSchema,
  EvidenceGapSchema,
  FlaggedClaimSchema,
  RemediationRoadmapSchema,
  SeveritySchema,
  ClaimStatusSchema,
  ReadinessStatusSchema
} from "./schema";
export type { ParseReportResult } from "./schema";

// LLM provider abstraction (BYO-key, provider-agnostic)
export {
  createOpenAIProvider,
  createAnthropicProvider,
  createOllamaProvider,
  providerFromConfig,
  LLMProviderError
} from "./providers";
export type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  LLMRole,
  LLMUsage,
  ProviderConfig,
  OpenAIProviderOptions,
  AnthropicProviderOptions,
  OllamaProviderOptions
} from "./providers";

// Prompts (with prompt-injection defense)
export {
  buildPentestPrompt,
  buildVerifierPrompt,
  collectVerifiableClaims,
  injectionCanaryChunk,
  randomDelimiter,
  INJECTION_CANARY
} from "./prompts";
export type { PentestPromptInput, BuiltPrompt, VerifierClaimPayload } from "./prompts";

// Cryptographic receipts (the compliance-grade differentiator)
export {
  buildReceipt,
  verifyReceipt,
  digestEvidence,
  digestReport,
  digestPrompt,
  digestVerdicts,
  canonicalJson,
  sha256,
  hmacSha256
} from "./receipts";
export type { Receipt, ReceiptInput, VerifyInput, VerifyResult, GroundingVerdict } from "./receipts";

// Deterministic post-LLM validator
export { validateReport } from "./validate";

// Plain-text rendering + small claim helpers
export { renderPlainTextReport, readinessLabel, allClaims } from "./plain-text";

// Sample/demo data + the structurally-valid empty report shell
export { emptyProjectDetails, emptyReport, demoEvidence, demoEvidencePack } from "./samples";

// The orchestrator — real provider or honest failure, no mock fallback
export { runReport, groundClaim, VerricEngineError } from "./engine";
export type {
  RunReportInput,
  RunReportResult,
  RunProgressStage,
  RunProgressEvent,
  GroundClaimInput,
  GroundClaimResult
} from "./engine";
