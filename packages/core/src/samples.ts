// Sample/demo data: project defaults, reference evidence pack.
// Used by the studio UI for the empty-state and by docs/screenshots.
//
// NOTE: this is NOT a mock-fallback. The runtime never invents results
// from samples. There is no demo report fabrication anywhere in the
// engine — see engine.ts: real provider or honest failure.

import type { EvidenceArtifact, ProjectDetails, VerricReport } from "./types";

export const emptyProjectDetails: ProjectDetails = {
  clientName: "Demo Corp",
  projectName: "External Web Application Penetration Test",
  assessmentType: "Web Application Penetration Test",
  preparedBy: "Team Stratosix",
  testerName: "Lead Security Consultant",
  classification: "Confidential",
  startDate: "2026-06-05",
  endDate: "2026-06-05",
  reportDate: "2026-06-05",
  scope: "10.10.10.5, https://demo.example.com, /admin application surface",
  outOfScope:
    "Denial-of-service testing, social engineering, and production data modification were excluded.",
  rulesOfEngagement:
    "Testing was performed using supplied evidence under controlled conditions. Findings are based on point-in-time artifacts.",
  methodology:
    "OWASP WSTG-inspired web testing, service enumeration, manual evidence review, and evidence-grounded AI drafting.",
  toolsUsed: "Nmap, Burp Suite, browser testing notes, terminal output"
};

/**
 * A structurally-valid but content-free report. Used as the UI's initial
 * state before a run completes — never as a fallback for a failed run.
 * The trust contract is "real provider or honest failure"; this function
 * returns nothing that could be mistaken for a real report.
 */
export function emptyReport(project: ProjectDetails = emptyProjectDetails): VerricReport {
  return {
    project,
    overallRisk: "Review",
    reportReadiness: "needs_details",
    readinessSummary: "No review has been run yet. Add evidence and click Run Verric Review.",
    globalGaps: [],
    executiveSummary: [],
    keyRecommendations: [],
    methodology: [],
    findings: [],
    remediationRoadmap: { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
    flaggedClaims: []
  };
}

export const demoEvidence = `$ nmap -sV 10.10.10.5

PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu
80/tcp   open  http    Apache httpd 2.4.18
3306/tcp open  mysql   MySQL 5.7.31

Burp finding:
Endpoint /admin returned 200 OK without authentication.
Request: GET /admin
Response: HTTP/1.1 200 OK

Notes:
The admin panel exposes user management controls.
Database access should not be reachable from the public network.
No screenshot was attached for the admin panel.
No vulnerability scanner output or exploit proof was collected for a specific CVE.`;

export const demoEvidencePack: EvidenceArtifact[] = [
  {
    id: "file-001",
    name: "nmap-scan.txt",
    kind: "text",
    type: "text/plain",
    size: 180,
    content: `$ nmap -sV 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu
80/tcp   open  http    Apache httpd 2.4.18
3306/tcp open  mysql   MySQL 5.7.31`
  },
  {
    id: "file-002",
    name: "burp-admin.http",
    kind: "text",
    type: "message/http",
    size: 260,
    content: `Request: GET /admin HTTP/1.1
Host: demo.example.com
Cookie: none

Response: HTTP/1.1 200 OK
Body: Admin dashboard loaded successfully.`
  },
  {
    id: "file-003",
    name: "tester-notes.md",
    kind: "notes",
    type: "text/markdown",
    size: 260,
    content: `# Tester Notes
The admin panel exposes user management controls.
Database access should not be reachable from the public network.
No screenshot was attached for the admin panel.
No exploit was performed against MySQL and no specific CVE was validated.`
  }
];
