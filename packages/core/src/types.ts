// All public types for the Verric engine. No runtime code lives here.
//
// The data model is intentionally claim-centric: every prose sentence in a
// final report is a `ReportClaim`, and the trust contract is that each
// claim cites zero or more `EvidenceChunk` IDs that the deterministic
// validator and the independent grounding pass have both vetted.

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Informational" | "Review";

export type ProjectDetails = {
  clientName: string;
  projectName: string;
  assessmentType: string;
  preparedBy: string;
  testerName: string;
  classification: string;
  startDate: string;
  endDate: string;
  reportDate: string;
  scope: string;
  outOfScope: string;
  rulesOfEngagement: string;
  methodology: string;
  toolsUsed: string;
};

export type EvidenceKind = "text" | "json" | "xml" | "image" | "pdf" | "notes" | "unknown";

export type EvidenceArtifact = {
  id: string;
  name: string;
  kind: EvidenceKind;
  type: string;
  size: number;
  content?: string;
  preview?: string;
};

export type EvidenceChunk = {
  id: string;
  artifactId: string;
  artifactName: string;
  lineStart: number;
  lineEnd: number;
  text: string;
};

export type ClaimStatus = "grounded" | "needs_review" | "flagged";

export type ReportClaim = {
  id: string;
  text: string;
  evidenceIds: string[];
  status: ClaimStatus;
  groundingNote?: string;
  /**
   * NLI-style confidence in [0, 1] that the cited evidence supports the
   * claim text. Set by the grounding pass; undefined when the claim
   * hasn't been verified yet (or when the verifier failed).
   *
   * Heuristic for v1:
   *   supported  → 0.85-0.95 (boosted slightly when 2+ chunks cited)
   *   partial    → 0.50
   *   unsupported → 0.10
   *
   * A real NLI model can drop in here later; the schema is forward-compatible.
   */
  confidence?: number;
};

export type EvidenceGap = {
  id: string;
  type:
    | "missing_project_detail"
    | "missing_scope"
    | "missing_asset"
    | "missing_poc"
    | "missing_impact"
    | "missing_cvss"
    | "unsupported_claim"
    | "missing_evidence";
  title: string;
  message: string;
  suggestedEvidence: string[];
  severity: "blocking" | "warning" | "info";
};

export type ReadinessStatus = "ready" | "needs_poc" | "needs_details" | "unsupported";

export type FlaggedClaim = {
  id: string;
  text: string;
  reason: string;
  relatedEvidenceIds: string[];
};

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  cvss: string;
  cvssVector: string;
  affectedAssets: string[];
  status: "Open" | "Ready for Report" | "Needs Review" | "Blocked";
  category: string;
  readiness: ReadinessStatus;
  readinessSummary: string;
  gaps: EvidenceGap[];
  description: ReportClaim[];
  impact: ReportClaim[];
  proofOfConcept: ReportClaim[];
  remediation: ReportClaim[];
  references: string[];
};

export type VerricReport = {
  project: ProjectDetails;
  overallRisk: Severity;
  reportReadiness: ReadinessStatus;
  readinessSummary: string;
  globalGaps: EvidenceGap[];
  executiveSummary: ReportClaim[];
  keyRecommendations: ReportClaim[];
  methodology: string[];
  findings: Finding[];
  remediationRoadmap: {
    immediate: string[];
    shortTerm: string[];
    mediumTerm: string[];
    longTerm: string[];
  };
  flaggedClaims: FlaggedClaim[];
};
