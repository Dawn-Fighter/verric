// validateReport: deterministic safety net that runs AFTER the LLM.
//
//   1. Strips evidence IDs the LLM cited that don't exist in the real chunks.
//   2. Recomputes CVSS from the vector so score/severity can never disagree.
//   3. Flips claim status to "needs_review" when no valid evidence remains.
//   4. Fills missing fields with safe defaults.
//
// This is an in-code DomainValidator (the seed of the Phase-1 interface).
// Pure, deterministic, no LLM in the loop.

import { cvssFromVector } from "./cvss";
import { emptyProjectDetails } from "./samples";
import type { EvidenceChunk, EvidenceGap, Finding, ReportClaim, VerricReport } from "./types";

export function validateReport(
  report: VerricReport,
  chunks: EvidenceChunk[],
  project = report.project
): VerricReport {
  const validIds = new Set(chunks.map((chunk) => chunk.id));

  const normalizeClaim = (claim: ReportClaim, fallbackId: string): ReportClaim => {
    const evidenceIds = Array.isArray(claim?.evidenceIds)
      ? claim.evidenceIds.filter((id) => validIds.has(id))
      : [];

    const normalized: ReportClaim = {
      id: claim?.id || fallbackId,
      text: claim?.text || "Claim requires reviewer input.",
      evidenceIds,
      status:
        evidenceIds.length > 0 && claim?.status !== "flagged" ? claim?.status || "grounded" : "needs_review"
    };
    if (claim?.groundingNote) normalized.groundingNote = claim.groundingNote;
    return normalized;
  };

  const normalizeGap = (item: EvidenceGap, index: number): EvidenceGap => ({
    id: item?.id || `gap-${index + 1}`,
    type: item?.type || "missing_evidence",
    title: item?.title || "Missing evidence",
    message: item?.message || "Verric needs more evidence before this item is report-ready.",
    suggestedEvidence: Array.isArray(item?.suggestedEvidence) ? item.suggestedEvidence : [],
    severity: item?.severity || "warning"
  });

  const normalizedFindings = (report.findings || []).map((finding, index) => {
    const gaps = (finding.gaps || []).map(normalizeGap);
    const readiness = finding.readiness || (gaps.length > 0 ? "needs_details" : "ready");
    const computed = cvssFromVector(finding.cvssVector || "");
    const cvss = computed ? computed.score.toFixed(1) : finding.cvss || "N/A";
    const severity = computed ? computed.severity : finding.severity || "Review";
    return {
      id: finding.id || `VRC-${String(index + 1).padStart(3, "0")}`,
      title: finding.title || "Untitled Finding",
      severity,
      cvss,
      cvssVector: finding.cvssVector || "N/A",
      affectedAssets: Array.isArray(finding.affectedAssets) ? finding.affectedAssets : [],
      status: finding.status || (gaps.length > 0 ? "Needs Review" : "Ready for Report"),
      category: finding.category || "Uncategorized",
      readiness,
      readinessSummary:
        finding.readinessSummary ||
        (gaps.length > 0 ? "Verric needs more information before export." : "Ready for report export."),
      gaps,
      description: (finding.description || []).map((claim, claimIndex) =>
        normalizeClaim(claim, `vrc-${index + 1}-desc-${claimIndex + 1}`)
      ),
      impact: (finding.impact || []).map((claim, claimIndex) =>
        normalizeClaim(claim, `vrc-${index + 1}-impact-${claimIndex + 1}`)
      ),
      proofOfConcept: (finding.proofOfConcept || []).map((claim, claimIndex) =>
        normalizeClaim(claim, `vrc-${index + 1}-poc-${claimIndex + 1}`)
      ),
      remediation: (finding.remediation || []).map((claim, claimIndex) =>
        normalizeClaim(claim, `vrc-${index + 1}-rem-${claimIndex + 1}`)
      ),
      references: Array.isArray(finding.references) ? finding.references : []
    } satisfies Finding;
  });

  const hasBlockingGaps = [
    ...(report.globalGaps || []),
    ...normalizedFindings.flatMap((finding) => finding.gaps)
  ].some((item) => item.severity === "blocking");

  return {
    project: project || emptyProjectDetails,
    overallRisk: report.overallRisk || "Review",
    reportReadiness: report.reportReadiness || (hasBlockingGaps ? "needs_details" : "ready"),
    readinessSummary:
      report.readinessSummary ||
      (hasBlockingGaps
        ? "Verric found missing evidence before final export."
        : "Report is ready for export."),
    globalGaps: (report.globalGaps || []).map(normalizeGap),
    executiveSummary: (report.executiveSummary || []).map((claim, index) =>
      normalizeClaim(claim, `sum-${index + 1}`)
    ),
    keyRecommendations: (report.keyRecommendations || []).map((claim, index) =>
      normalizeClaim(claim, `rec-${index + 1}`)
    ),
    methodology: Array.isArray(report.methodology) ? report.methodology : [],
    findings: normalizedFindings,
    remediationRoadmap: report.remediationRoadmap || {
      immediate: [],
      shortTerm: [],
      mediumTerm: [],
      longTerm: []
    },
    flaggedClaims: (report.flaggedClaims || []).map((claim, index) => ({
      id: claim.id || `flag-${index + 1}`,
      text: claim.text || "Unsupported claim requires review.",
      reason: claim.reason || "The claim did not include enough evidence to ship automatically.",
      relatedEvidenceIds: Array.isArray(claim.relatedEvidenceIds)
        ? claim.relatedEvidenceIds.filter((id) => validIds.has(id))
        : []
    }))
  };
}
