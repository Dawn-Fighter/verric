// Plain-text rendering of a Verric report. Used by the .txt export route
// and as a fallback when the rich PDF/DOCX renderers fail.

import type { EvidenceChunk, ReadinessStatus, ReportClaim, VerricReport } from "./types";

export function readinessLabel(status: ReadinessStatus) {
  if (status === "ready") return "Ready to Export";
  if (status === "needs_poc") return "Needs PoC";
  if (status === "unsupported") return "Unsupported";
  return "Needs Details";
}

export function allClaims(report: VerricReport): ReportClaim[] {
  return [
    ...report.executiveSummary,
    ...report.keyRecommendations,
    ...report.findings.flatMap((finding) => [
      ...finding.description,
      ...finding.impact,
      ...finding.proofOfConcept,
      ...finding.remediation
    ])
  ];
}

export function renderPlainTextReport(report: VerricReport, chunks: EvidenceChunk[]): string {
  const lines: string[] = [];
  lines.push(`${report.project.projectName}`);
  lines.push(`Client: ${report.project.clientName}`);
  lines.push(`Classification: ${report.project.classification}`);
  lines.push(`Overall Risk: ${report.overallRisk}`);
  lines.push("");
  lines.push("Executive Summary");
  report.executiveSummary.forEach((claim) => lines.push(`- ${claim.text}`));
  lines.push("");
  lines.push("Findings Summary");
  report.findings.forEach((finding) =>
    lines.push(`- ${finding.id}: ${finding.title} (${finding.severity}, ${finding.readiness})`)
  );
  lines.push("");

  for (const finding of report.findings) {
    lines.push(`${finding.id}: ${finding.title}`);
    lines.push(`Severity: ${finding.severity}`);
    lines.push(`CVSS: ${finding.cvss} ${finding.cvssVector}`);
    lines.push(`Affected Assets: ${finding.affectedAssets.join(", ")}`);
    lines.push(`Readiness: ${readinessLabel(finding.readiness)}`);
    if (finding.gaps.length > 0) {
      lines.push("Missing Evidence:");
      finding.gaps.forEach((item) => lines.push(`- ${item.title}: ${item.message}`));
    }
    lines.push("Description:");
    finding.description.forEach((claim) => lines.push(`- ${claim.text}`));
    lines.push("Impact:");
    finding.impact.forEach((claim) => lines.push(`- ${claim.text}`));
    lines.push("Proof of Concept:");
    finding.proofOfConcept.forEach((claim) => lines.push(`- ${claim.text}`));
    lines.push("Remediation:");
    finding.remediation.forEach((claim) => lines.push(`- ${claim.text}`));
    lines.push("");
  }

  lines.push("Evidence Appendix");
  chunks.forEach((chunk) =>
    lines.push(`${chunk.id} | ${chunk.artifactName}:${chunk.lineStart} | ${chunk.text}`)
  );
  return lines.join("\n");
}
