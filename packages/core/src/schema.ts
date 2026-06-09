// Zod schemas for the VerricReport. These run on raw LLM output BEFORE
// validateReport's deterministic pass — schema failures trigger a repair
// retry; if the repair also fails, the engine returns an honest error
// rather than fabricating a result.
//
// Keep this file in lockstep with src/types.ts.

import { z } from "zod";

export const SeveritySchema = z.enum(["Critical", "High", "Medium", "Low", "Informational", "Review"]);

export const ClaimStatusSchema = z.enum(["grounded", "needs_review", "flagged"]);

export const ReadinessStatusSchema = z.enum(["ready", "needs_poc", "needs_details", "unsupported"]);

export const ProjectDetailsSchema = z.object({
  clientName: z.string(),
  projectName: z.string(),
  assessmentType: z.string(),
  preparedBy: z.string(),
  testerName: z.string(),
  classification: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reportDate: z.string(),
  scope: z.string(),
  outOfScope: z.string(),
  rulesOfEngagement: z.string(),
  methodology: z.string(),
  toolsUsed: z.string()
});

export const ReportClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  evidenceIds: z.array(z.string()),
  status: ClaimStatusSchema,
  groundingNote: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const EvidenceGapSchema = z.object({
  id: z.string(),
  type: z.enum([
    "missing_project_detail",
    "missing_scope",
    "missing_asset",
    "missing_poc",
    "missing_impact",
    "missing_cvss",
    "unsupported_claim",
    "missing_evidence"
  ]),
  title: z.string(),
  message: z.string(),
  suggestedEvidence: z.array(z.string()),
  severity: z.enum(["blocking", "warning", "info"])
});

export const FindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  cvss: z.string(),
  cvssVector: z.string(),
  affectedAssets: z.array(z.string()),
  status: z.enum(["Open", "Ready for Report", "Needs Review", "Blocked"]),
  category: z.string(),
  readiness: ReadinessStatusSchema,
  readinessSummary: z.string(),
  gaps: z.array(EvidenceGapSchema),
  description: z.array(ReportClaimSchema),
  impact: z.array(ReportClaimSchema),
  proofOfConcept: z.array(ReportClaimSchema),
  remediation: z.array(ReportClaimSchema),
  references: z.array(z.string())
});

export const FlaggedClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  reason: z.string(),
  relatedEvidenceIds: z.array(z.string())
});

export const RemediationRoadmapSchema = z.object({
  immediate: z.array(z.string()),
  shortTerm: z.array(z.string()),
  mediumTerm: z.array(z.string()),
  longTerm: z.array(z.string())
});

export const VerricReportSchema = z.object({
  project: ProjectDetailsSchema,
  overallRisk: SeveritySchema,
  reportReadiness: ReadinessStatusSchema,
  readinessSummary: z.string(),
  globalGaps: z.array(EvidenceGapSchema),
  executiveSummary: z.array(ReportClaimSchema),
  keyRecommendations: z.array(ReportClaimSchema),
  methodology: z.array(z.string()),
  findings: z.array(FindingSchema),
  remediationRoadmap: RemediationRoadmapSchema,
  flaggedClaims: z.array(FlaggedClaimSchema)
});

// Looser variant used during the initial parse: arrays may be missing,
// strings may be empty. validateReport then fills the gaps.
export const VerricReportLooseSchema = VerricReportSchema.partial().extend({
  findings: z.array(FindingSchema.partial()).optional()
});

export type ParseReportResult =
  | { ok: true; report: z.infer<typeof VerricReportSchema> }
  | { ok: false; error: string; issues: z.ZodIssue[] };

/**
 * Parse a JSON string into a VerricReport. Tolerant of missing fields
 * (those are filled by validateReport downstream); strict about types.
 *
 * Returns a Result rather than throwing so callers can decide whether
 * to retry the LLM with the validation error in the prompt.
 */
export function parseReportJson(text: string): ParseReportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${(err as Error).message}`,
      issues: []
    };
  }
  // We accept the loose shape from the LLM, then upgrade missing fields
  // with empty defaults so the strict schema passes.
  const looseResult = VerricReportLooseSchema.safeParse(raw);
  if (!looseResult.success) {
    return {
      ok: false,
      error: "Schema validation failed",
      issues: looseResult.error.issues
    };
  }
  // Sanity: the LLM must have produced at least ONE report-shaped key,
  // otherwise it gave us garbage. Without this, an arbitrary object like
  // {"not":"a","valid":"report"} parses successfully (because every
  // field is optional in the loose schema) and turns into an empty report.
  type Loose = z.infer<typeof VerricReportLooseSchema>;
  const loose = looseResult.data as Loose;
  const reportShapedKeys: Array<keyof Loose> = [
    "project",
    "overallRisk",
    "reportReadiness",
    "executiveSummary",
    "findings",
    "globalGaps",
    "keyRecommendations",
    "remediationRoadmap"
  ];
  const hasAnyReportShape = reportShapedKeys.some((k) => loose[k] !== undefined);
  if (!hasAnyReportShape) {
    return {
      ok: false,
      error: "Payload has no report-shaped keys",
      issues: []
    };
  }
  // Fill in defaults to satisfy the strict schema. validateReport will
  // do further normalization, but the strict schema catches real issues
  // (wrong enum values, wrong field types) early.
  const filled = {
    project: loose.project ?? {
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
    overallRisk: loose.overallRisk ?? "Review",
    reportReadiness: loose.reportReadiness ?? "needs_details",
    readinessSummary: loose.readinessSummary ?? "",
    globalGaps: loose.globalGaps ?? [],
    executiveSummary: loose.executiveSummary ?? [],
    keyRecommendations: loose.keyRecommendations ?? [],
    methodology: loose.methodology ?? [],
    findings: (loose.findings ?? []).map((f) => ({
      id: f.id ?? "",
      title: f.title ?? "Untitled Finding",
      severity: f.severity ?? "Review",
      cvss: f.cvss ?? "N/A",
      cvssVector: f.cvssVector ?? "N/A",
      affectedAssets: f.affectedAssets ?? [],
      status: f.status ?? "Needs Review",
      category: f.category ?? "Uncategorized",
      readiness: f.readiness ?? "needs_details",
      readinessSummary: f.readinessSummary ?? "",
      gaps: f.gaps ?? [],
      description: f.description ?? [],
      impact: f.impact ?? [],
      proofOfConcept: f.proofOfConcept ?? [],
      remediation: f.remediation ?? [],
      references: f.references ?? []
    })),
    remediationRoadmap: loose.remediationRoadmap ?? {
      immediate: [],
      shortTerm: [],
      mediumTerm: [],
      longTerm: []
    },
    flaggedClaims: loose.flaggedClaims ?? []
  };
  const strict = VerricReportSchema.safeParse(filled);
  if (!strict.success) {
    return {
      ok: false,
      error: "Strict schema validation failed",
      issues: strict.error.issues
    };
  }
  return { ok: true, report: strict.data };
}
