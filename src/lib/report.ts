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

// ----------------------------------------------------------------------------
// CVSS 3.1 base score — pure, no deps. Computes from vector so score, vector,
// and severity can never disagree.
// ----------------------------------------------------------------------------

const CVSS_METRICS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR_U: { N: 0.85, L: 0.62, H: 0.27 },
  PR_C: { N: 0.85, L: 0.68, H: 0.5 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 }
};

function severityFromScore(score: number): Severity {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  if (score > 0) return "Low";
  return "Informational";
}

function roundUp1(value: number) {
  // CVSS roundup: ceil to one decimal place (per spec, with float-safety)
  const r = Math.round(value * 100000);
  if (r % 10000 === 0) return r / 100000;
  return (Math.floor(r / 10000) + 1) / 10;
}

export function cvssFromVector(vector: string): { score: number; severity: Severity } | null {
  if (!vector || vector === "N/A") return null;
  const m = vector.match(/CVSS:3\.[01]\/(.+)/i);
  if (!m) return null;
  const parts = m[1].split("/").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split(":");
    if (k && v) acc[k.trim().toUpperCase()] = v.trim().toUpperCase();
    return acc;
  }, {});

  const required = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"];
  for (const key of required) if (!(key in parts)) return null;

  const scope = parts.S; // U or C
  const av = CVSS_METRICS.AV[parts.AV];
  const ac = CVSS_METRICS.AC[parts.AC];
  const pr = (scope === "C" ? CVSS_METRICS.PR_C : CVSS_METRICS.PR_U)[parts.PR];
  const ui = CVSS_METRICS.UI[parts.UI];
  const c = CVSS_METRICS.C[parts.C];
  const i = CVSS_METRICS.I[parts.I];
  const a = CVSS_METRICS.A[parts.A];
  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined)) return null;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === "C" ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;

  let score: number;
  if (impact <= 0) {
    score = 0;
  } else if (scope === "C") {
    score = roundUp1(Math.min(1.08 * (impact + exploitability), 10));
  } else {
    score = roundUp1(Math.min(impact + exploitability, 10));
  }

  return { score, severity: severityFromScore(score) };
}

// ----------------------------------------------------------------------------
// Nmap plain-text parser — turns -sV output into structured Hosts/Services.
// Targets the classic "PORT STATE SERVICE VERSION" table.
// ----------------------------------------------------------------------------

export type NmapPort = {
  port: number;
  proto: string;
  state: string;
  service: string;
  version: string;
};

export type NmapHost = {
  host: string;
  ip: string;
  ports: NmapPort[];
};

export function isNmapContent(content: string): boolean {
  if (!content) return false;
  const head = content.slice(0, 4000);
  return /Nmap scan report|^PORT\s+STATE\s+SERVICE/im.test(head) && /\b\d{1,5}\/(tcp|udp)\b/.test(head);
}

export function parseNmap(content: string): NmapHost[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const hosts: NmapHost[] = [];
  let current: NmapHost | null = null;
  let inPortTable = false;

  const pushHost = () => {
    if (current && current.ports.length > 0) hosts.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const reportMatch = line.match(/^Nmap scan report for\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/i);
    if (reportMatch) {
      pushHost();
      const left = reportMatch[1].trim();
      const right = reportMatch[2]?.trim();
      // "host (ip)" pattern -> left=host, right=ip; bare IP -> left only
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(left);
      current = {
        host: right ? left : isIp ? left : left,
        ip: right || (isIp ? left : ""),
        ports: []
      };
      inPortTable = false;
      continue;
    }

    if (/^PORT\s+STATE\s+SERVICE/i.test(line.trim())) {
      inPortTable = true;
      continue;
    }

    if (inPortTable) {
      // 22/tcp   open  ssh     OpenSSH 7.2p2 Ubuntu ...
      const portMatch = line.match(/^\s*(\d{1,5})\/(tcp|udp)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/i);
      if (portMatch) {
        if (!current) current = { host: "", ip: "", ports: [] };
        current.ports.push({
          port: Number(portMatch[1]),
          proto: portMatch[2].toLowerCase(),
          state: portMatch[3].toLowerCase(),
          service: portMatch[4],
          version: (portMatch[5] || "").trim()
        });
        continue;
      }
      // table ends on blank or non-matching content
      if (!/^\s/.test(line) && !/^\s*\d/.test(line)) inPortTable = false;
    }
  }

  pushHost();
  return hosts;
}

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
  outOfScope: "Denial-of-service testing, social engineering, and production data modification were excluded.",
  rulesOfEngagement: "Testing was performed using supplied evidence under controlled conditions. Findings are based on point-in-time artifacts.",
  methodology: "OWASP WSTG-inspired web testing, service enumeration, manual evidence review, and evidence-grounded AI drafting.",
  toolsUsed: "Nmap, Burp Suite, browser testing notes, terminal output"
};

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

export function inferEvidenceKind(fileName: string, mimeType = ""): EvidenceKind {
  const name = fileName.toLowerCase();
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || mimeType.startsWith("image/")) {
    return "image";
  }
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".json") || name.endsWith(".har")) return "json";
  if (name.endsWith(".xml")) return "xml";
  if (name.endsWith(".md")) return "notes";
  if (/\.(txt|log|csv|http|req|res)$/i.test(name) || mimeType.startsWith("text/")) return "text";
  return "unknown";
}

export function buildEvidenceChunks(artifacts: EvidenceArtifact[], manualNotes: string): EvidenceChunk[] {
  const normalizedArtifacts = [...artifacts];
  if (manualNotes.trim()) {
    normalizedArtifacts.push({
      id: "manual-notes",
      name: "manual-notes.md",
      kind: "notes",
      type: "text/markdown",
      size: manualNotes.length,
      content: manualNotes
    });
  }

  const chunks: EvidenceChunk[] = [];
  for (const artifact of normalizedArtifacts) {
    if (artifact.kind === "image" || artifact.kind === "pdf") {
      chunks.push({
        id: `ev-${String(chunks.length + 1).padStart(3, "0")}`,
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `${artifact.kind.toUpperCase()} artifact supplied: ${artifact.name}`
      });
      continue;
    }

    const content = artifact.content || "";

    // If this artifact looks like nmap, also emit one structured chunk per port
    // ON TOP of the raw line chunks. Structured chunks read like:
    //   "Nmap: 10.10.10.5 port 22/tcp open ssh — OpenSSH 7.2p2 Ubuntu"
    // so the LLM can ground claims to a parsed fact rather than a raw line.
    if (isNmapContent(content)) {
      const hosts = parseNmap(content);
      for (const host of hosts) {
        const target = host.ip || host.host || "host";
        for (const port of host.ports) {
          chunks.push({
            id: `ev-${String(chunks.length + 1).padStart(3, "0")}`,
            artifactId: artifact.id,
            artifactName: artifact.name,
            lineStart: 1,
            lineEnd: 1,
            text: `Nmap: ${target} port ${port.port}/${port.proto} ${port.state} ${port.service}${port.version ? ` — ${port.version}` : ""}`
          });
        }
      }
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      chunks.push({
        id: `ev-${String(chunks.length + 1).padStart(3, "0")}`,
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: index + 1,
        lineEnd: index + 1,
        text: line
      });
    });
  }

  return chunks.slice(0, 180);
}

export function chunkEvidence(rawEvidence: string): EvidenceChunk[] {
  return buildEvidenceChunks(
    [
      {
        id: "raw-evidence",
        name: "raw-evidence.txt",
        kind: "text",
        type: "text/plain",
        size: rawEvidence.length,
        content: rawEvidence
      }
    ],
    ""
  );
}

function ids(chunks: EvidenceChunk[], matcher: RegExp, fallback = 0) {
  const found = chunks.filter((chunk) => matcher.test(chunk.text)).map((chunk) => chunk.id);
  if (found.length > 0) return found;
  return chunks[fallback] ? [chunks[fallback].id] : [];
}

const gap = (
  id: string,
  type: EvidenceGap["type"],
  title: string,
  message: string,
  suggestedEvidence: string[],
  severity: EvidenceGap["severity"] = "blocking"
): EvidenceGap => ({ id, type, title, message, suggestedEvidence, severity });

export function createMockReport(chunks: EvidenceChunk[], project: ProjectDetails = emptyProjectDetails): VerricReport {
  const sshIds = ids(chunks, /22\/tcp|OpenSSH/i, 0);
  const httpIds = ids(chunks, /80\/tcp|Apache/i, 1);
  const mysqlIds = ids(chunks, /3306\/tcp|mysql/i, 2);
  const adminIds = ids(chunks, /\/admin|without authentication|Admin dashboard|user management/i, 3);
  const screenshotIds = ids(chunks, /screenshot|PNG artifact|JPG artifact|JPEG artifact/i, -1).filter(Boolean);
  const requestIds = ids(chunks, /Request: GET \/admin|Response: HTTP\/1\.1 200|returned 200 OK/i, 4);
  const assetIds = Array.from(new Set([...sshIds, ...httpIds, ...mysqlIds, ...adminIds])).slice(0, 6);
  const adminNeedsPoc = screenshotIds.length === 0;

  return {
    project,
    overallRisk: "High",
    reportReadiness: adminNeedsPoc ? "needs_poc" : "ready",
    readinessSummary: adminNeedsPoc
      ? "Verric found reportable issues, but at least one high-value finding needs stronger PoC evidence before final client export."
      : "The supplied evidence is sufficient to draft a client-ready report with the current findings.",
    globalGaps: [
      ...(!project.clientName.trim()
        ? [gap("global-client", "missing_project_detail", "Client name missing", "Add the client name for the cover page and executive summary.", ["Client legal or project display name"])]
        : []),
      ...(!project.scope.trim()
        ? [gap("global-scope", "missing_scope", "Scope missing", "Add in-scope targets so the report can separate tested assets from assumptions.", ["IP ranges", "Domains", "Application routes", "Assessment limitations"])]
        : [])
    ],
    executiveSummary: [
      {
        id: "sum-001",
        text: `The assessment evidence for ${project.clientName || "the client"} shows exposed network services and an administrative endpoint accessible without authentication.`,
        evidenceIds: assetIds,
        status: "grounded"
      },
      {
        id: "sum-002",
        text: "The highest-priority issue is the unauthenticated administrative endpoint because the supplied request and response evidence indicates successful access to the admin surface.",
        evidenceIds: Array.from(new Set([...adminIds, ...requestIds])),
        status: "grounded"
      },
      {
        id: "sum-003",
        text: "The exposed MySQL service increases attack surface and should be restricted to trusted administrative or application networks.",
        evidenceIds: mysqlIds,
        status: "grounded"
      }
    ],
    keyRecommendations: [
      {
        id: "rec-001",
        text: "Require authentication and role-based authorization before serving administrative routes.",
        evidenceIds: adminIds,
        status: "grounded"
      },
      {
        id: "rec-002",
        text: "Restrict database exposure so MySQL is reachable only from approved internal hosts or VPN ranges.",
        evidenceIds: mysqlIds,
        status: "grounded"
      }
    ],
    methodology: [
      "OWASP WSTG-inspired evidence review",
      "Service enumeration and web request/response review",
      "Verric AI readiness analysis for missing PoC, unsupported claims, and report completeness"
    ],
    findings: [
      {
        id: "VRC-001",
        title: "Unauthenticated Administrative Panel",
        severity: "High",
        cvss: "8.1",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N",
        affectedAssets: ["/admin"],
        status: adminNeedsPoc ? "Needs Review" : "Ready for Report",
        category: "Broken Access Control",
        readiness: adminNeedsPoc ? "needs_poc" : "ready",
        readinessSummary: adminNeedsPoc
          ? "The finding is strong, but Verric recommends adding screenshot evidence or richer request/response proof before final export."
          : "The finding has enough request/response and visual proof to export.",
        gaps: adminNeedsPoc
          ? [
              gap(
                "gap-vrc-001-poc",
                "missing_poc",
                "Add visual or complete request/response PoC",
                "The evidence shows /admin returned HTTP 200 OK, but a polished client report should include a screenshot or complete Burp request/response showing the exposed admin controls.",
                ["Screenshot of the exposed admin panel", "Burp request and response pair", "Browser reproduction steps with URL and expected result"]
              )
            ]
          : [],
        description: [
          {
            id: "vrc-001-desc-001",
            text: "The /admin endpoint returned HTTP 200 OK without authentication.",
            evidenceIds: requestIds,
            status: "grounded"
          },
          {
            id: "vrc-001-desc-002",
            text: "The available notes state that the admin panel exposes user management controls.",
            evidenceIds: adminIds,
            status: "grounded"
          }
        ],
        impact: [
          {
            id: "vrc-001-impact-001",
            text: "An unauthenticated administrative interface may allow unauthorized users to access sensitive management functionality.",
            evidenceIds: adminIds,
            status: "grounded"
          }
        ],
        proofOfConcept: [
          {
            id: "vrc-001-poc-001",
            text: "A request to GET /admin returned HTTP/1.1 200 OK according to the supplied evidence.",
            evidenceIds: requestIds,
            status: requestIds.length > 0 ? "grounded" : "needs_review"
          }
        ],
        remediation: [
          {
            id: "vrc-001-rem-001",
            text: "Enforce server-side authentication and role-based authorization checks for the administrative route before returning any content.",
            evidenceIds: adminIds,
            status: "grounded"
          }
        ],
        references: ["OWASP Top 10 A01: Broken Access Control", "CWE-306: Missing Authentication for Critical Function"]
      },
      {
        id: "VRC-002",
        title: "Publicly Exposed MySQL Service",
        severity: "Medium",
        cvss: "5.3",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N",
        affectedAssets: ["10.10.10.5:3306"],
        status: "Ready for Report",
        category: "Network Exposure",
        readiness: "ready",
        readinessSummary: "The service exposure is directly supported by scan output. Verric blocked unproven CVE claims for this finding.",
        gaps: [],
        description: [
          {
            id: "vrc-002-desc-001",
            text: "The host exposes MySQL 5.7.31 on TCP port 3306.",
            evidenceIds: mysqlIds,
            status: "grounded"
          }
        ],
        impact: [
          {
            id: "vrc-002-impact-001",
            text: "Exposing database services to untrusted networks increases the likelihood of credential attacks, service fingerprinting, and unauthorized access attempts.",
            evidenceIds: mysqlIds,
            status: "grounded"
          }
        ],
        proofOfConcept: [
          {
            id: "vrc-002-poc-001",
            text: "The Nmap scan output identifies MySQL as open on TCP port 3306.",
            evidenceIds: mysqlIds,
            status: "grounded"
          }
        ],
        remediation: [
          {
            id: "vrc-002-rem-001",
            text: "Limit MySQL access to required application hosts and administrative networks using firewall rules or private networking.",
            evidenceIds: mysqlIds,
            status: "grounded"
          }
        ],
        references: ["CIS Controls: Network Infrastructure Management"]
      },
      {
        id: "VRC-003",
        title: "Server Version Disclosure",
        severity: "Low",
        cvss: "3.7",
        cvssVector: "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N",
        affectedAssets: ["10.10.10.5:22", "10.10.10.5:80"],
        status: "Ready for Report",
        category: "Information Disclosure",
        readiness: "ready",
        readinessSummary: "The disclosed service versions are directly visible in the scan evidence.",
        gaps: [],
        description: [
          {
            id: "vrc-003-desc-001",
            text: "The scan output discloses OpenSSH 7.2p2 and Apache httpd 2.4.18 service versions.",
            evidenceIds: [...sshIds, ...httpIds],
            status: "grounded"
          }
        ],
        impact: [
          {
            id: "vrc-003-impact-001",
            text: "Version disclosure can help attackers prioritize follow-up research against exposed services.",
            evidenceIds: [...sshIds, ...httpIds],
            status: "grounded"
          }
        ],
        proofOfConcept: [
          {
            id: "vrc-003-poc-001",
            text: "The scan output includes explicit OpenSSH and Apache version banners.",
            evidenceIds: [...sshIds, ...httpIds],
            status: "grounded"
          }
        ],
        remediation: [
          {
            id: "vrc-003-rem-001",
            text: "Review exposed service banners and reduce unnecessary version disclosure where operationally feasible.",
            evidenceIds: [...sshIds, ...httpIds],
            status: "grounded"
          }
        ],
        references: ["CWE-200: Exposure of Sensitive Information to an Unauthorized Actor"]
      }
    ],
    remediationRoadmap: {
      immediate: ["Protect the administrative endpoint with authentication and authorization controls."],
      shortTerm: ["Restrict MySQL exposure to approved internal systems or VPN ranges."],
      mediumTerm: ["Review exposed service banners and remove unnecessary version disclosure."],
      longTerm: ["Adopt evidence capture standards for every finding: request, response, screenshot, and reproduction notes."]
    },
    flaggedClaims: [
      {
        id: "flag-001",
        text: "The exposed MySQL version is vulnerable to a specific CVE.",
        reason: "The supplied evidence identifies the service and version, but does not include vulnerability scanner output, exploit verification, or a CVE reference.",
        relatedEvidenceIds: mysqlIds
      },
      {
        id: "flag-002",
        text: "The administrative panel allows complete account takeover.",
        reason: "The evidence shows unauthenticated access and user management controls, but does not prove a completed account takeover path.",
        relatedEvidenceIds: adminIds
      }
    ]
  };
}

export function validateReport(report: VerricReport, chunks: EvidenceChunk[], project = report.project): VerricReport {
  const validIds = new Set(chunks.map((chunk) => chunk.id));

  const normalizeClaim = (claim: ReportClaim, fallbackId: string): ReportClaim => {
    const evidenceIds = Array.isArray(claim?.evidenceIds)
      ? claim.evidenceIds.filter((id) => validIds.has(id))
      : [];

    const normalized: ReportClaim = {
      id: claim?.id || fallbackId,
      text: claim?.text || "Claim requires reviewer input.",
      evidenceIds,
      status: evidenceIds.length > 0 && claim?.status !== "flagged" ? claim?.status || "grounded" : "needs_review"
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
      readinessSummary: finding.readinessSummary || (gaps.length > 0 ? "Verric needs more information before export." : "Ready for report export."),
      gaps,
      description: (finding.description || []).map((claim, claimIndex) => normalizeClaim(claim, `vrc-${index + 1}-desc-${claimIndex + 1}`)),
      impact: (finding.impact || []).map((claim, claimIndex) => normalizeClaim(claim, `vrc-${index + 1}-impact-${claimIndex + 1}`)),
      proofOfConcept: (finding.proofOfConcept || []).map((claim, claimIndex) => normalizeClaim(claim, `vrc-${index + 1}-poc-${claimIndex + 1}`)),
      remediation: (finding.remediation || []).map((claim, claimIndex) => normalizeClaim(claim, `vrc-${index + 1}-rem-${claimIndex + 1}`)),
      references: Array.isArray(finding.references) ? finding.references : []
    } satisfies Finding;
  });

  const hasBlockingGaps = [...(report.globalGaps || []), ...normalizedFindings.flatMap((finding) => finding.gaps)].some(
    (item) => item.severity === "blocking"
  );

  return {
    project: project || emptyProjectDetails,
    overallRisk: report.overallRisk || "Review",
    reportReadiness: report.reportReadiness || (hasBlockingGaps ? "needs_details" : "ready"),
    readinessSummary: report.readinessSummary || (hasBlockingGaps ? "Verric found missing evidence before final export." : "Report is ready for export."),
    globalGaps: (report.globalGaps || []).map(normalizeGap),
    executiveSummary: (report.executiveSummary || []).map((claim, index) => normalizeClaim(claim, `sum-${index + 1}`)),
    keyRecommendations: (report.keyRecommendations || []).map((claim, index) => normalizeClaim(claim, `rec-${index + 1}`)),
    methodology: Array.isArray(report.methodology) ? report.methodology : [],
    findings: normalizedFindings,
    remediationRoadmap: report.remediationRoadmap || { immediate: [], shortTerm: [], mediumTerm: [], longTerm: [] },
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

export function readinessLabel(status: ReadinessStatus) {
  if (status === "ready") return "Ready to Export";
  if (status === "needs_poc") return "Needs PoC";
  if (status === "unsupported") return "Unsupported";
  return "Needs Details";
}

export function allClaims(report: VerricReport) {
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

export function renderPlainTextReport(report: VerricReport, chunks: EvidenceChunk[]) {
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
  report.findings.forEach((finding) => lines.push(`- ${finding.id}: ${finding.title} (${finding.severity}, ${finding.readiness})`));
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
  chunks.forEach((chunk) => lines.push(`${chunk.id} | ${chunk.artifactName}:${chunk.lineStart} | ${chunk.text}`));
  return lines.join("\n");
}
