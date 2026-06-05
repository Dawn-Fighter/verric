import { NextResponse } from "next/server";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import { type EvidenceArtifact, type EvidenceChunk, type Finding, type ReportClaim, type VerricReport } from "@/lib/report";

export const runtime = "nodejs";

const RED = "C73524";
const INK = "17140F";
const MUTED = "716B60";

const text = (value: string, options: { bold?: boolean; color?: string; size?: number } = {}) =>
  new TextRun({ text: value, bold: options.bold, color: options.color || INK, size: options.size || 22 });

const p = (value: string, options: { bold?: boolean; color?: string; size?: number; spacing?: number } = {}) =>
  new Paragraph({ children: [text(value, options)], spacing: { after: options.spacing ?? 120 } });

const h = (value: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
  new Paragraph({ text: value, heading: level, spacing: { before: 320, after: 160 } });

const label = (value: string) =>
  new Paragraph({ children: [new TextRun({ text: value.toUpperCase(), bold: true, color: MUTED, size: 16, font: "Courier New" })], spacing: { after: 60 } });

const bullet = (value: string) =>
  new Paragraph({ children: [text(value)], bullet: { level: 0 }, spacing: { after: 80 } });

function cell(children: Paragraph[], width?: number) {
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    children
  });
}

function table(rows: TableRow[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" }
    },
    rows
  });
}

function specCell(value: string, options: { bold?: boolean; color?: string; mono?: boolean; header?: boolean } = {}) {
  const run = new TextRun({
    text: value,
    bold: options.bold || options.header,
    color: options.color || (options.header ? MUTED : INK),
    size: options.header ? 16 : 20,
    font: options.mono ? "Courier New" : options.header ? "Courier New" : undefined
  });
  return new TableCell({
    width: { size: options.header ? 26 : 74, type: WidthType.PERCENTAGE },
    shading: options.header ? { fill: "F3EFE6", type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ children: [run], spacing: { after: 0 } })]
  });
}

function specRow(label: string, value: string, mono = false) {
  return new TableRow({ children: [specCell(label, { header: true }), specCell(value, { mono })] });
}

function specTable(rows: Array<[string, string, boolean?]>) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2600, 7400],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" }
    },
    rows: rows.map(([label, value, mono]) => specRow(label, value, mono))
  });
}

function claimParagraphs(title: string, claims: ReportClaim[]) {
  const verified = claims.filter((claim) => claim.status === "grounded");
  if (verified.length === 0) return [];
  return [label(title), ...verified.map((claim) => p(`${claim.text}${claim.evidenceIds.length ? ` [${claim.evidenceIds.join(", ")}]` : ""}`))];
}

function isVerifiedClaim(claim: ReportClaim) {
  return claim.status === "grounded";
}

type UnverifiedRow = { source: string; text: string; status: ReportClaim["status"]; reason: string };

function collectUnverifiedClaims(report: VerricReport, confirmed: Finding[]): UnverifiedRow[] {
  const rows: UnverifiedRow[] = [];
  const push = (claim: ReportClaim, source: string) => {
    if (isVerifiedClaim(claim)) return;
    rows.push({
      source,
      text: claim.text,
      status: claim.status,
      reason: claim.groundingNote || (claim.status === "flagged" ? "Cited evidence does not support this claim." : "Cited evidence partially supports this claim.")
    });
  };
  report.executiveSummary.forEach((claim) => push(claim, "Executive Summary"));
  report.keyRecommendations.forEach((claim) => push(claim, "Key Recommendations"));
  for (const finding of confirmed) {
    finding.description.forEach((claim) => push(claim, `${finding.id} · Description`));
    finding.impact.forEach((claim) => push(claim, `${finding.id} · Impact`));
    finding.proofOfConcept.forEach((claim) => push(claim, `${finding.id} · Proof of Concept`));
    finding.remediation.forEach((claim) => push(claim, `${finding.id} · Remediation`));
  }
  return rows;
}

function unverifiedClaimsTable(rows: UnverifiedRow[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2400, 4800, 1400, 2400],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "C9BEAC" }
    },
    rows: [
      new TableRow({
        children: ["Source", "Statement", "Status", "Reviewer Note"].map((heading) =>
          new TableCell({
            shading: { fill: "F3EFE6", type: ShadingType.CLEAR, color: "auto" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: heading, bold: true, color: MUTED, size: 18 })], spacing: { after: 0 } })]
          })
        )
      }),
      ...rows.slice(0, 14).map((row) => new TableRow({
        children: [
          new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: row.source, color: MUTED, size: 20 })], spacing: { after: 0 } })] }),
          new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: row.text, color: INK, size: 20 })], spacing: { after: 0 } })] }),
          new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: row.status === "flagged" ? "Unsupported" : "Partial", bold: true, color: row.status === "flagged" ? RED : "A15C07", size: 20 })], spacing: { after: 0 } })] }),
          new TableCell({ margins: { top: 100, bottom: 100, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: row.reason, color: INK, size: 20 })], spacing: { after: 0 } })] })
        ]
      }))
    ]
  });
}

function findingEvidenceIds(finding: Finding) {
  return Array.from(new Set([...finding.description, ...finding.impact, ...finding.proofOfConcept, ...finding.remediation].flatMap((claim) => claim.evidenceIds || [])));
}

function isUnconfirmedFinding(finding: Finding) {
  const textValue = [finding.title, finding.readinessSummary, ...finding.proofOfConcept.map((claim) => claim.text)].join(" ");
  return /potential|candidate|unconfirmed|not confirmed|requires further|no successful payload|needs poc/i.test(textValue) || finding.readiness === "needs_poc" || finding.readiness === "unsupported";
}

function imageDataFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  return {
    type: (match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase()) as "png" | "jpg",
    data: Buffer.from(match[2], "base64")
  };
}

function imageParagraphs(artifacts: EvidenceArtifact[] = []) {
  return artifacts
    .filter((artifact) => artifact.kind === "image" && artifact.preview)
    .slice(0, 6)
    .flatMap((artifact) => {
      const parsed = imageDataFromDataUrl(artifact.preview || "");
      if (!parsed) return [];
      return [
        h(`Screenshot Evidence: ${artifact.name}`, HeadingLevel.HEADING_2),
        new Paragraph({
          children: [
            new ImageRun({
              data: parsed.data,
              transformation: { width: 560, height: 315 },
              type: parsed.type
            })
          ],
          spacing: { after: 240 }
        })
      ];
    });
}

function findingSection(finding: Finding, chunkMap: Map<string, EvidenceChunk>) {
  const evidence = findingEvidenceIds(finding).map((id) => chunkMap.get(id)).filter(Boolean).slice(0, 8) as EvidenceChunk[];
  return [
    h(`${finding.id}: ${finding.title}`, HeadingLevel.HEADING_2),
    specTable([
      ["Severity", `${finding.severity} (CVSS ${finding.cvss})`],
      ["CVSS Vector", finding.cvssVector, true],
      ["Affected Assets", finding.affectedAssets.join(", ") || "N/A"],
      ["Category", finding.category],
      ["Status", finding.status],
      ["References", finding.references.join("; ") || "N/A"]
    ]),
    ...claimParagraphs("Description", finding.description),
    ...claimParagraphs("Business / Technical Impact", finding.impact),
    ...claimParagraphs("Proof of Concept", finding.proofOfConcept),
    ...(evidence.length ? [label("Key Evidence Excerpts"), ...evidence.map((chunk) => p(`${chunk.id} | ${chunk.artifactName}:${chunk.lineStart} | ${chunk.text}`))] : []),
    ...claimParagraphs("Remediation", finding.remediation)
  ];
}

export async function POST(request: Request) {
  const { report, chunks, artifacts } = (await request.json()) as {
    report: VerricReport;
    chunks: EvidenceChunk[];
    artifacts?: EvidenceArtifact[];
  };
  const chunkMap = new Map((chunks || []).map((chunk) => [chunk.id, chunk]));
  const confirmedFindings = report.findings.filter((finding) => !isUnconfirmedFinding(finding));
  const unconfirmedFindings = report.findings.filter(isUnconfirmedFinding);
  const unverifiedClaims = collectUnverifiedClaims(report, confirmedFindings);
  const usedEvidence = Array.from(new Set(confirmedFindings.flatMap(findingEvidenceIds))).map((id) => chunkMap.get(id)).filter(Boolean).slice(0, 50) as EvidenceChunk[];

  const findingsRows = [
    new TableRow({ children: ["ID", "Finding", "Severity", "CVSS", "Affected Asset"].map((item) => cell([p(item, { bold: true, color: MUTED })])) }),
    ...confirmedFindings.map((finding) => new TableRow({ children: [finding.id, finding.title, finding.severity, finding.cvss, finding.affectedAssets.join(", ") || "N/A"].map((item) => cell([p(item)])) }))
  ];

  const riskRows = [
    new TableRow({ children: ["Rating", "CVSS", "Remediation Guidance"].map((item) => cell([p(item, { bold: true, color: MUTED })])) }),
    ...[
      ["Critical", "9.0-10.0", "Immediate remediation or compensating control within 24-48 hours."],
      ["High", "7.0-8.9", "Prioritize remediation within 7 days."],
      ["Medium", "4.0-6.9", "Address within 30 days or next planned release cycle."],
      ["Low", "0.1-3.9", "Address as part of routine hardening."],
      ["Informational", "0.0", "Best-practice improvement."]
    ].map((row) => new TableRow({ children: row.map((item) => cell([p(item)])) }))
  ];

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Aptos", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 36, color: INK } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 28, color: INK } }
      ]
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: "Penetration Test Report", bold: true, size: 44, color: INK })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 520 }, children: [new TextRun({ text: report.project.clientName, bold: true, size: 40, color: RED })] }),
          table([
            new TableRow({ children: [cell([label("Project"), p(report.project.projectName)]), cell([label("Assessment"), p(report.project.assessmentType)]), cell([label("Classification"), p(report.project.classification)])] }),
            new TableRow({ children: [cell([label("Prepared By"), p(report.project.preparedBy)]), cell([label("Lead Tester"), p(report.project.testerName)]), cell([label("Report Date"), p(report.project.reportDate)])] })
          ]),
          h("Document Control"),
          specTable([
            ["Prepared For", report.project.clientName],
            ["Overall Risk", report.overallRisk],
            ["Confirmed Findings", String(confirmedFindings.length)],
            ["Items Requiring Validation", String(unconfirmedFindings.length)]
          ]),
          h("Executive Summary"),
          ...report.executiveSummary.filter(isVerifiedClaim).map((claim) => p(claim.text)),
          h("Key Recommendations"),
          ...report.keyRecommendations.filter(isVerifiedClaim).map((claim) => bullet(claim.text)),
          h("Scope & Methodology"),
          specTable([
            ["Assessment Period", `${report.project.startDate} to ${report.project.endDate}`],
            ["In Scope", report.project.scope],
            ["Out of Scope", report.project.outOfScope],
            ...(report.project.rulesOfEngagement ? [["Rules of Engagement", report.project.rulesOfEngagement] as [string, string]] : []),
            ...(report.project.toolsUsed ? [["Tools Used", report.project.toolsUsed] as [string, string]] : [])
          ]),
          label("Methodology"),
          ...report.methodology.map((item) => bullet(item)),
          h("Risk Rating Methodology"),
          table(riskRows),
          h("Findings Summary"),
          table(findingsRows),
          ...(unconfirmedFindings.length > 0
            ? [
                h("Items Requiring Validation"),
                p("The following observations are not included as confirmed vulnerabilities because the supplied evidence does not prove exploitation."),
                ...unconfirmedFindings.map((finding) => p(`${finding.id}: ${finding.title} - ${finding.readinessSummary || "Additional PoC required."}`))
              ]
            : []),
          ...(unverifiedClaims.length > 0
            ? [
                h("Claims Pending Independent Verification"),
                p("Verric's grounding pass could not independently confirm that the cited evidence supports the following statements. They have been removed from the polished body of this report and are listed here for reviewer attention."),
                unverifiedClaimsTable(unverifiedClaims)
              ]
            : []),
          h("Detailed Findings"),
          ...confirmedFindings.flatMap((finding) => findingSection(finding, chunkMap)),
          h("Remediation Roadmap"),
          label("Immediate"),
          ...report.remediationRoadmap.immediate.map((item) => bullet(item)),
          label("Short Term"),
          ...report.remediationRoadmap.shortTerm.map((item) => bullet(item)),
          label("Medium / Long Term"),
          ...[...report.remediationRoadmap.mediumTerm, ...report.remediationRoadmap.longTerm].map((item) => bullet(item)),
          h("Evidence Reference Index"),
          p("The following evidence references were cited by the report findings. Raw tool output is summarized rather than dumped in full."),
          ...usedEvidence.map((chunk) => p(`${chunk.id} | ${chunk.artifactName}:${chunk.lineStart} | ${chunk.text}`)),
          ...imageParagraphs(artifacts || []),
          h("Disclaimer & Limitations"),
          p("This report is based on a point-in-time review of the supplied evidence and project scope. It does not guarantee that all possible vulnerabilities were identified. Findings should be validated by the testing team and remediated according to organizational risk tolerance.")
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="verric-${report.project.clientName || "client"}-report.docx"`
    }
  });
}
