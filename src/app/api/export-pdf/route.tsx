import React from "react";
import { NextResponse } from "next/server";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { type EvidenceArtifact, type EvidenceChunk, type Finding, type ReportClaim, type VerricReport } from "@/lib/report";

export const runtime = "nodejs";

const colors = {
  navy: "#1f3a5f",
  blue: "#2f5f95",
  red: "#b42318",
  amber: "#a15c07",
  green: "#18794e",
  gray900: "#111827",
  gray700: "#374151",
  gray500: "#6b7280",
  gray200: "#e5e7eb",
  gray100: "#f3f4f6",
  white: "#ffffff"
};

const styles = StyleSheet.create({
  page: { padding: 42, paddingBottom: 56, backgroundColor: colors.white, color: colors.gray900, fontFamily: "Helvetica", fontSize: 9.5, lineHeight: 1.45 },
  cover: { padding: 54, backgroundColor: colors.white, color: colors.gray900, fontFamily: "Helvetica" },
  coverBar: { height: 7, backgroundColor: colors.navy, marginBottom: 72 },
  coverTitle: { fontSize: 34, fontFamily: "Helvetica-Bold", color: colors.navy, marginBottom: 10 },
  coverSub: { fontSize: 17, color: colors.gray700, marginBottom: 34 },
  h1: { fontSize: 20, fontFamily: "Helvetica-Bold", color: colors.navy, marginBottom: 10 },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", color: colors.navy, marginBottom: 7, marginTop: 9 },
  h3: { fontSize: 12, fontFamily: "Helvetica-Bold", color: colors.gray900, marginBottom: 5 },
  label: { fontSize: 7.2, fontFamily: "Helvetica-Bold", color: colors.gray500, textTransform: "uppercase" },
  caption: { fontSize: 8, fontFamily: "Helvetica-Bold", color: colors.gray700 },
  small: { fontSize: 8, color: colors.gray500 },
  section: { marginBottom: 16 },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.gray200, paddingBottom: 7, marginBottom: 12 },
  box: { borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.white },
  row: { flexDirection: "row" },
  cell: { flex: 1, padding: 8, borderRightWidth: 1, borderRightColor: colors.gray200 },
  lastCell: { flex: 1, padding: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.gray200 },
  th: { padding: 6, fontSize: 7, fontFamily: "Helvetica-Bold", color: colors.gray700, backgroundColor: colors.gray100 },
  td: { padding: 6, fontSize: 8.4 },
  finding: { borderWidth: 1, borderColor: colors.gray200, marginBottom: 18 },
  findingHead: { padding: 12, backgroundColor: colors.gray100, borderBottomWidth: 1, borderBottomColor: colors.gray200 },
  findingId: { fontSize: 8, fontFamily: "Helvetica-Bold", color: colors.blue, letterSpacing: 1, marginBottom: 4 },
  findingTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", color: colors.navy, lineHeight: 1.25, marginBottom: 6 },
  findingMeta: { fontSize: 8.5, color: colors.gray700 },
  specRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.gray200 },
  specLabel: { width: 120, padding: 7, backgroundColor: colors.gray100, borderRightWidth: 1, borderRightColor: colors.gray200, fontSize: 7.2, fontFamily: "Helvetica-Bold", color: colors.gray700, textTransform: "uppercase" },
  specValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0, padding: 7, fontSize: 8.6 },
  claim: { marginTop: 4, marginBottom: 6 },
  evidenceTag: { fontSize: 7.5, color: colors.gray500, marginTop: 2 },
  code: { fontFamily: "Courier", fontSize: 7.2, backgroundColor: colors.gray100, borderWidth: 1, borderColor: colors.gray200, padding: 6, marginTop: 4 },
  footer: { position: "absolute", left: 42, right: 42, bottom: 24, borderTopWidth: 1, borderTopColor: colors.gray200, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  screenshot: { width: "100%", maxHeight: 380, objectFit: "contain", borderWidth: 1, borderColor: colors.gray200, marginTop: 7 }
});

function severityColor(severity: string) {
  if (severity === "Critical" || severity === "High") return colors.red;
  if (severity === "Medium" || severity === "Review") return colors.amber;
  if (severity === "Low" || severity === "Informational") return colors.green;
  return colors.gray700;
}

function isUnconfirmedFinding(finding: Finding) {
  const text = [finding.title, finding.readinessSummary, ...finding.proofOfConcept.map((claim) => claim.text)].join(" ");
  return /potential|candidate|unconfirmed|not confirmed|requires further|no successful payload|needs poc/i.test(text) || finding.readiness === "needs_poc" || finding.readiness === "unsupported";
}

function isVerified(claim: ReportClaim) {
  return claim.status === "grounded";
}

function partitionClaims(claims: ReportClaim[]): { verified: ReportClaim[]; unverified: ReportClaim[] } {
  return {
    verified: claims.filter(isVerified),
    unverified: claims.filter((claim) => !isVerified(claim))
  };
}

type UnverifiedRow = {
  source: string;
  text: string;
  status: ReportClaim["status"];
  reason: string;
};

function collectUnverifiedClaims(report: VerricReport, confirmed: Finding[]): UnverifiedRow[] {
  const rows: UnverifiedRow[] = [];
  const push = (claim: ReportClaim, source: string) => {
    if (isVerified(claim)) return;
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

function findingEvidenceIds(finding: Finding) {
  return Array.from(new Set([...finding.description, ...finding.impact, ...finding.proofOfConcept, ...finding.remediation].flatMap((claim) => claim.evidenceIds || [])));
}

function chunkMap(chunks: EvidenceChunk[]) {
  return new Map(chunks.map((chunk) => [chunk.id, chunk]));
}

function Footer({ report }: { report: VerricReport }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.small}>{report.project.classification} · Penetration Test Report</Text>
      <Text style={styles.small}>{report.project.clientName}</Text>
    </View>
  );
}

function EvidenceRefs({ ids }: { ids: string[] }) {
  return ids.length ? <Text style={styles.evidenceTag}>Evidence: {ids.slice(0, 8).join(", ")}</Text> : null;
}

function ClaimList({ title, claims }: { title: string; claims: ReportClaim[] }) {
  const verified = claims.filter(isVerified);
  if (verified.length === 0) return null;
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <Text style={styles.h3}>{title}</Text>
      {verified.map((claim) => (
        <View key={claim.id} style={styles.claim}>
          <Text>{claim.text}</Text>
          <EvidenceRefs ids={claim.evidenceIds} />
        </View>
      ))}
    </View>
  );
}

function Cover({ report }: { report: VerricReport }) {
  return (
    <Page size="A4" style={styles.cover}>
      <View style={styles.coverBar} />
      <Text style={styles.coverTitle}>Penetration Test Report</Text>
      <Text style={styles.coverSub}>{report.project.clientName}</Text>
      <View style={{ ...styles.box, marginTop: 36 }}>
        <View style={styles.row}>
          <View style={styles.cell}><Text style={styles.label}>Project</Text><Text>{report.project.projectName}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Assessment Type</Text><Text>{report.project.assessmentType}</Text></View>
          <View style={styles.lastCell}><Text style={styles.label}>Classification</Text><Text>{report.project.classification}</Text></View>
        </View>
        <View style={{ ...styles.row, borderTopWidth: 1, borderTopColor: colors.gray200 }}>
          <View style={styles.cell}><Text style={styles.label}>Prepared By</Text><Text>{report.project.preparedBy}</Text></View>
          <View style={styles.cell}><Text style={styles.label}>Lead Tester</Text><Text>{report.project.testerName}</Text></View>
          <View style={styles.lastCell}><Text style={styles.label}>Report Date</Text><Text>{report.project.reportDate}</Text></View>
        </View>
      </View>
      <View style={{ marginTop: 34 }}>
        <Text style={styles.label}>Overall Risk</Text>
        <Text style={{ fontSize: 26, color: severityColor(report.overallRisk), fontFamily: "Helvetica-Bold" }}>{report.overallRisk}</Text>
      </View>
    </Page>
  );
}

function SummaryPage({ report, confirmed, unconfirmed }: { report: VerricReport; confirmed: Finding[]; unconfirmed: Finding[] }) {
  const counts = ["Critical", "High", "Medium", "Low", "Informational"].map((severity) => ({ severity, count: confirmed.filter((finding) => finding.severity === severity).length }));

  return (
    <Page size="A4" style={styles.page}>
      <Footer report={report} />
      <View style={styles.rule}><Text style={styles.h1}>Executive Summary</Text></View>
      <View style={styles.section}>{report.executiveSummary.filter(isVerified).map((claim) => <Text key={claim.id} style={{ marginBottom: 6 }}>{claim.text}</Text>)}</View>
      <View style={styles.section}>
        <Text style={styles.h2}>Assessment Overview</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <View style={styles.cell}><Text style={styles.label}>Confirmed Findings</Text><Text>{String(confirmed.length)}</Text></View>
            <View style={styles.cell}><Text style={styles.label}>Items Requiring Validation</Text><Text>{String(unconfirmed.length)}</Text></View>
            <View style={styles.lastCell}><Text style={styles.label}>Overall Risk</Text><Text style={{ color: severityColor(report.overallRisk), fontFamily: "Helvetica-Bold" }}>{report.overallRisk}</Text></View>
          </View>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={styles.h2}>Severity Distribution</Text>
        <View style={styles.box}><View style={styles.row}>{counts.map((item, index) => <View key={item.severity} style={index === counts.length - 1 ? styles.lastCell : styles.cell}><Text style={styles.label}>{item.severity}</Text><Text style={{ fontSize: 18, color: severityColor(item.severity), fontFamily: "Helvetica-Bold" }}>{item.count}</Text></View>)}</View></View>
      </View>
      <View style={styles.section}>
        <Text style={styles.h2}>Key Recommendations</Text>
        {report.keyRecommendations.filter(isVerified).map((claim) => <Text key={claim.id} style={{ marginBottom: 5 }}>• {claim.text}</Text>)}
      </View>
      <View style={styles.section}>
        <Text style={styles.h2}>Scope & Methodology</Text>
        <View style={styles.box}>
          <View style={styles.specRow} wrap={false}>
            <Text style={styles.specLabel}>Assessment Period</Text>
            <Text style={styles.specValue}>{report.project.startDate} to {report.project.endDate}</Text>
          </View>
          <View style={styles.specRow} wrap={false}>
            <Text style={styles.specLabel}>In Scope</Text>
            <Text style={styles.specValue}>{report.project.scope}</Text>
          </View>
          <View style={styles.specRow} wrap={false}>
            <Text style={styles.specLabel}>Out of Scope</Text>
            <Text style={styles.specValue}>{report.project.outOfScope}</Text>
          </View>
          {report.project.rulesOfEngagement ? (
            <View style={styles.specRow} wrap={false}>
              <Text style={styles.specLabel}>Rules of Engagement</Text>
              <Text style={styles.specValue}>{report.project.rulesOfEngagement}</Text>
            </View>
          ) : null}
          {report.project.toolsUsed ? (
            <View style={styles.specRow} wrap={false}>
              <Text style={styles.specLabel}>Tools Used</Text>
              <Text style={styles.specValue}>{report.project.toolsUsed}</Text>
            </View>
          ) : null}
          <View style={{ ...styles.specRow, borderBottomWidth: 0 }}>
            <Text style={styles.specLabel}>Methodology</Text>
            <View style={styles.specValue}>{report.methodology.map((item) => <Text key={item}>• {item}</Text>)}</View>
          </View>
        </View>
      </View>
    </Page>
  );
}

function RiskMethodologyPage({ report }: { report: VerricReport }) {
  const rows = [
    ["Critical", "9.0-10.0", "Immediate remediation or compensating control within 24-48 hours."],
    ["High", "7.0-8.9", "Prioritize remediation within 7 days."],
    ["Medium", "4.0-6.9", "Address within 30 days or next planned release cycle."],
    ["Low", "0.1-3.9", "Address as part of routine hardening."],
    ["Informational", "0.0", "Best-practice improvement with no direct exploitability shown."]
  ];
  return (
    <Page size="A4" style={styles.page}>
      <Footer report={report} />
      <View style={styles.rule}><Text style={styles.h1}>Risk Rating Methodology</Text></View>
      <Text style={{ marginBottom: 12 }}>Severity ratings are based on the technical characteristics of the issue, demonstrated exploitability, affected asset exposure, and likely business impact. CVSS is used as a baseline where sufficient evidence is available.</Text>
      <View style={styles.box}>{rows.map((row, index) => <View key={row[0]} style={styles.tableRow}><Text style={{ ...styles.td, width: 90, color: severityColor(row[0]), fontFamily: "Helvetica-Bold" }}>{row[0]}</Text><Text style={{ ...styles.td, width: 85 }}>{row[1]}</Text><Text style={{ ...styles.td, flex: 1 }}>{row[2]}</Text></View>)}</View>
    </Page>
  );
}

function FindingsSummaryPage({ report, confirmed, unconfirmed, unverifiedClaims }: { report: VerricReport; confirmed: Finding[]; unconfirmed: Finding[]; unverifiedClaims: UnverifiedRow[] }) {
  return (
    <Page size="A4" style={styles.page}>
      <Footer report={report} />
      <View style={styles.rule}><Text style={styles.h1}>Findings Summary</Text></View>
      <View style={styles.box}>
        <View style={styles.tableRow}><Text style={{ ...styles.th, width: 60 }}>ID</Text><Text style={{ ...styles.th, flex: 1 }}>Finding</Text><Text style={{ ...styles.th, width: 70 }}>Severity</Text><Text style={{ ...styles.th, width: 60 }}>CVSS</Text><Text style={{ ...styles.th, width: 130 }}>Affected Asset</Text></View>
        {confirmed.map((finding) => <View key={finding.id} style={styles.tableRow}><Text style={{ ...styles.td, width: 60, color: colors.blue, fontFamily: "Helvetica-Bold" }}>{finding.id}</Text><Text style={{ ...styles.td, flex: 1 }}>{finding.title}</Text><Text style={{ ...styles.td, width: 70, color: severityColor(finding.severity), fontFamily: "Helvetica-Bold" }}>{finding.severity}</Text><Text style={{ ...styles.td, width: 60 }}>{finding.cvss}</Text><Text style={{ ...styles.td, width: 130 }}>{finding.affectedAssets.join(", ") || "N/A"}</Text></View>)}
      </View>
      {unconfirmed.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <Text style={styles.h2}>Items Requiring Validation</Text>
          <Text style={{ marginBottom: 8 }}>The following observations were not included as confirmed vulnerabilities because the supplied evidence does not prove exploitation.</Text>
          <View style={styles.box}>
            <View style={styles.tableRow}>
              <Text style={{ ...styles.th, width: 60 }}>ID</Text>
              <Text style={{ ...styles.th, width: 200 }}>Observation</Text>
              <Text style={{ ...styles.th, flex: 1 }}>Reason for Validation</Text>
            </View>
            {unconfirmed.map((finding) => (
              <View key={finding.id} style={styles.tableRow}>
                <Text style={{ ...styles.td, width: 60, color: colors.gray700, fontFamily: "Helvetica-Bold" }}>{finding.id}</Text>
                <Text style={{ ...styles.td, width: 200 }}>{finding.title}</Text>
                <Text style={{ ...styles.td, flex: 1 }}>{finding.readinessSummary || "Additional PoC required"}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {unverifiedClaims.length > 0 ? (
        <View style={{ marginTop: 18 }} wrap={false}>
          <Text style={styles.h2}>Claims Pending Independent Verification</Text>
          <Text style={{ marginBottom: 8 }}>Verric&apos;s grounding pass could not independently confirm that the cited evidence supports the following statements. They have been removed from the polished body of this report and are listed here for reviewer attention.</Text>
          <View style={styles.box}>
            <View style={styles.tableRow}>
              <Text style={{ ...styles.th, width: 130 }}>Source</Text>
              <Text style={{ ...styles.th, flex: 1 }}>Statement</Text>
              <Text style={{ ...styles.th, width: 70 }}>Status</Text>
              <Text style={{ ...styles.th, width: 150 }}>Reviewer Note</Text>
            </View>
            {unverifiedClaims.slice(0, 14).map((row, idx) => (
              <View key={`${row.source}-${idx}`} style={styles.tableRow}>
                <Text style={{ ...styles.td, width: 130, color: colors.gray700 }}>{row.source}</Text>
                <Text style={{ ...styles.td, flex: 1 }}>{row.text}</Text>
                <Text style={{ ...styles.td, width: 70, color: row.status === "flagged" ? colors.red : colors.amber, fontFamily: "Helvetica-Bold" }}>{row.status === "flagged" ? "Unsupported" : "Partial"}</Text>
                <Text style={{ ...styles.td, width: 150 }}>{row.reason}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ marginTop: 20 }}>
        <Text style={styles.h2}>Remediation Priority</Text>
        <View style={styles.box}><View style={styles.row}><View style={styles.cell}><Text style={styles.label}>Immediate</Text>{report.remediationRoadmap.immediate.map((item) => <Text key={item}>• {item}</Text>)}</View><View style={styles.cell}><Text style={styles.label}>Short Term</Text>{report.remediationRoadmap.shortTerm.map((item) => <Text key={item}>• {item}</Text>)}</View><View style={styles.lastCell}><Text style={styles.label}>Medium / Long Term</Text>{[...report.remediationRoadmap.mediumTerm, ...report.remediationRoadmap.longTerm].map((item) => <Text key={item}>• {item}</Text>)}</View></View></View>
      </View>
    </Page>
  );
}

function SpecRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View style={last ? { ...styles.specRow, borderBottomWidth: 0 } : styles.specRow} wrap={false}>
      <Text style={styles.specLabel}>{label}</Text>
      <Text style={mono ? { ...styles.specValue, fontFamily: "Courier", fontSize: 8 } : styles.specValue}>{value}</Text>
    </View>
  );
}

function FindingSection({ finding, chunks }: { finding: Finding; chunks: Map<string, EvidenceChunk> }) {
  const evidence = findingEvidenceIds(finding).map((id) => chunks.get(id)).filter(Boolean).slice(0, 8) as EvidenceChunk[];
  return (
    <View style={styles.finding} wrap={true}>
      <View style={styles.findingHead} wrap={false}>
        <Text style={styles.findingId}>{finding.id}</Text>
        <Text style={styles.findingTitle}>{finding.title}</Text>
        <Text style={styles.findingMeta}>
          {finding.category} {"  ·  "} Severity:{" "}
          <Text style={{ color: severityColor(finding.severity), fontFamily: "Helvetica-Bold" }}>{finding.severity}</Text>
          {"  ·  "} CVSS {finding.cvss}
        </Text>
      </View>
      <View style={{ padding: 12 }}>
        <View style={styles.box} wrap={false}>
          <SpecRow label="Affected Asset" value={finding.affectedAssets.join(", ") || "N/A"} />
          <SpecRow label="CVSS Score" value={`${finding.cvss} ${finding.severity}`} />
          <SpecRow label="CVSS Vector" value={finding.cvssVector} mono />
          <SpecRow label="References" value={finding.references.slice(0, 3).join("; ") || "N/A"} last />
        </View>
        <ClaimList title="Description" claims={finding.description} />
        <ClaimList title="Business and Technical Impact" claims={finding.impact} />
        <ClaimList title="Proof of Concept" claims={finding.proofOfConcept} />
        {evidence.length > 0 ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={styles.h3}>Key Evidence</Text>
            {evidence.map((chunk) => (
              <Text key={chunk.id} style={styles.code}>{chunk.id} · {chunk.artifactName}:{chunk.lineStart} · {chunk.text}</Text>
            ))}
          </View>
        ) : null}
        <ClaimList title="Remediation" claims={finding.remediation} />
      </View>
    </View>
  );
}

function EvidencePage({ report, chunks, artifacts }: { report: VerricReport; chunks: EvidenceChunk[]; artifacts: EvidenceArtifact[] }) {
  const confirmed = report.findings.filter((finding) => !isUnconfirmedFinding(finding));
  const usedIds = Array.from(new Set(confirmed.flatMap(findingEvidenceIds)));
  const map = chunkMap(chunks);
  const usedChunks = usedIds.map((id) => map.get(id)).filter(Boolean).slice(0, 45) as EvidenceChunk[];
  const images = artifacts.filter((artifact) => artifact.kind === "image" && artifact.preview).slice(0, 6);
  return (
    <Page size="A4" style={styles.page}>
      <Footer report={report} />
      <View style={styles.rule}><Text style={styles.h1}>Evidence Appendix</Text></View>
      <Text style={{ marginBottom: 10 }}>The appendix includes cited evidence excerpts and uploaded screenshots supporting the confirmed findings.</Text>
      <View style={styles.box}>
        <View style={styles.tableRow}>
          <Text style={{ ...styles.th, width: 60 }}>ID</Text>
          <Text style={{ ...styles.th, width: 155 }}>Source</Text>
          <Text style={{ ...styles.th, flex: 1 }}>Excerpt</Text>
        </View>
        {usedChunks.map((chunk) => (
          <View key={chunk.id} style={styles.tableRow} wrap={false}>
            <Text style={{ ...styles.td, width: 60, color: colors.blue, fontFamily: "Helvetica-Bold" }}>{chunk.id}</Text>
            <Text style={{ ...styles.td, width: 155 }}>{chunk.artifactName}:{chunk.lineStart}</Text>
            <Text style={{ ...styles.td, flex: 1 }}>{chunk.text}</Text>
          </View>
        ))}
      </View>
      {images.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.h2}>Screenshot Evidence</Text>
          {images.map((artifact) => (
            <View key={artifact.id} style={{ marginBottom: 14 }} wrap={false}>
              <Text style={styles.caption}>{artifact.name}</Text>
              <Image src={artifact.preview || ""} style={styles.screenshot} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: 18 }} wrap={false}>
        <Text style={styles.h2}>Disclaimer and Limitations</Text>
        <Text>This report is based on a point-in-time review of the supplied evidence and agreed scope. It does not guarantee that all possible vulnerabilities were identified. Findings should be validated by the testing team and remediated according to organizational risk tolerance.</Text>
      </View>
    </Page>
  );
}

function DetailedFindingsPage({ report, confirmed, chunks }: { report: VerricReport; confirmed: Finding[]; chunks: Map<string, EvidenceChunk> }) {
  return (
    <Page size="A4" style={styles.page}>
      <Footer report={report} />
      <View style={styles.rule}><Text style={styles.h1}>Detailed Findings</Text></View>
      {confirmed.map((finding) => <FindingSection key={finding.id} finding={finding} chunks={chunks} />)}
    </Page>
  );
}

function ReportPdf({ report, chunks, artifacts }: { report: VerricReport; chunks: EvidenceChunk[]; artifacts: EvidenceArtifact[] }) {
  const confirmed = report.findings.filter((finding) => !isUnconfirmedFinding(finding));
  const unconfirmed = report.findings.filter(isUnconfirmedFinding);
  const map = chunkMap(chunks);
  const unverifiedClaims = collectUnverifiedClaims(report, confirmed);
  return (
    <Document title={`${report.project.clientName} Penetration Test Report`}>
      <Cover report={report} />
      <SummaryPage report={report} confirmed={confirmed} unconfirmed={unconfirmed} />
      <RiskMethodologyPage report={report} />
      <FindingsSummaryPage report={report} confirmed={confirmed} unconfirmed={unconfirmed} unverifiedClaims={unverifiedClaims} />
      <DetailedFindingsPage report={report} confirmed={confirmed} chunks={map} />
      <EvidencePage report={report} chunks={chunks} artifacts={artifacts} />
    </Document>
  );
}

export async function POST(request: Request) {
  const { report, chunks, artifacts } = (await request.json()) as { report: VerricReport; chunks: EvidenceChunk[]; artifacts?: EvidenceArtifact[] };
  const pdf = await renderToBuffer(<ReportPdf report={report} chunks={chunks || []} artifacts={artifacts || []} />);
  return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="verric-${report.project.clientName || "client"}-report.pdf"` } });
}
