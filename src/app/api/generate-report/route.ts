import { NextResponse } from "next/server";
import {
  type EvidenceArtifact,
  type EvidenceChunk,
  type ProjectDetails,
  type ReportClaim,
  createMockReport,
  emptyProjectDetails,
  validateReport,
  type VerricReport
} from "@/lib/report";

export const runtime = "nodejs";

function extractJson(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return cleaned;
  return cleaned.slice(start, end + 1);
}

// ----------------------------------------------------------------------------
// verifyGrounding: independent second-pass LLM check that every claim's cited
// evidence actually supports the sentence. Mutates the report in-place.
// Wrapped in try/catch by the caller — never breaks the demo.
// ----------------------------------------------------------------------------

type Verdict = { claimId: string; verdict: "supported" | "partial" | "unsupported"; reason?: string };

function collectClaims(report: VerricReport): ReportClaim[] {
  // Verify only factual/observational claims. Remediation guidance and
  // executive recommendations are prescriptive (what to do) rather than
  // assertions about what evidence proves, so we don't ground-check them —
  // otherwise good professional advice gets unfairly flagged for not being
  // literally quoted in the source artifact.
  const all: ReportClaim[] = [
    ...report.executiveSummary,
    ...report.findings.flatMap((finding) => [
      ...finding.description,
      ...finding.impact,
      ...finding.proofOfConcept
    ])
  ];
  return all.filter((claim) => claim.evidenceIds.length > 0);
}

async function verifyGrounding(report: VerricReport, chunks: EvidenceChunk[]): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const chunkLookup = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const claimsToCheck = collectClaims(report);
  if (claimsToCheck.length === 0) return;

  // Build a compact payload. Truncate evidence text to keep tokens bounded.
  const payload = claimsToCheck.map((claim) => ({
    claimId: claim.id,
    text: claim.text,
    evidence: claim.evidenceIds
      .map((id) => {
        const c = chunkLookup.get(id);
        return c ? `${c.id}: ${c.text.slice(0, 400)}` : null;
      })
      .filter(Boolean)
  }));

  const prompt = `You are Verric's grounding verifier. For each claim, decide whether the cited evidence ACTUALLY supports the exact sentence.

Verdict definitions:
- "supported": the evidence directly proves the claim, OR the claim is a reasonable, conservative interpretation of what the evidence shows (paraphrasing the same fact in standard pentest language is fine; standard impact statements that follow logically from the demonstrated condition are fine).
- "partial": the evidence is related but the claim adds material the evidence does not support — extra severity, extra scope, additional facts. Or the claim conflates multiple distinct evidence items.
- "unsupported": the evidence does not back the claim at all, OR the claim makes a genuine factual leap (e.g. asserts successful exploitation when evidence only shows access; asserts a specific CVE not mentioned; invents data exfiltration, account takeover, credential theft, or production impact that wasn't demonstrated).

Important nuances:
- A description that paraphrases a request/response in standard professional language is "supported", not "partial".
- An impact statement that says "this could allow X" where X is the standard, well-known impact of the demonstrated vulnerability class (e.g. "unauthenticated admin access could allow unauthorized actions") is "supported". Impact sentences are not required to be literally quoted in the evidence.
- Reserve "unsupported" for claims that invent facts, overstate exploitation, or assert outcomes the tester did not actually demonstrate.
- Reserve "partial" for claims that add unsupported specifics on top of supported facts.

Return JSON: {"verdicts":[{"claimId":"...","verdict":"supported|partial|unsupported","reason":"<10-word reason>"}]}

Claims:
${JSON.stringify(payload, null, 2)}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a strict evidence-grounding verifier. Return JSON only." },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    console.error("Grounding verification call failed", response.status);
    return;
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return;

  const parsed = JSON.parse(extractJson(content)) as { verdicts?: Verdict[] };
  if (!Array.isArray(parsed.verdicts)) return;

  const verdictMap = new Map(parsed.verdicts.map((v) => [v.claimId, v]));
  const apply = (claim: ReportClaim) => {
    const v = verdictMap.get(claim.id);
    if (!v) return;
    if (v.verdict === "supported") {
      claim.status = "grounded";
      claim.groundingNote = undefined;
    } else if (v.verdict === "partial") {
      claim.status = "needs_review";
      claim.groundingNote = v.reason ? `Verric: ${v.reason}` : "Verric: evidence partially supports this claim.";
    } else {
      claim.status = "flagged";
      claim.groundingNote = v.reason ? `Verric: ${v.reason}` : "Verric: cited evidence does not support this claim.";
    }
  };

  report.executiveSummary.forEach(apply);
  for (const finding of report.findings) {
    finding.description.forEach(apply);
    finding.impact.forEach(apply);
    finding.proofOfConcept.forEach(apply);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      project?: ProjectDetails;
      chunks?: EvidenceChunk[];
      artifacts?: EvidenceArtifact[];
    };
    const project = body.project || emptyProjectDetails;
    const chunks = (body.chunks || []).slice(0, 180);
    const artifacts = (body.artifacts || []).slice(0, 10);

    if (chunks.length === 0) {
      return NextResponse.json({ error: "No evidence chunks provided." }, { status: 400 });
    }

    const useMock = process.env.USE_MOCK_REPORT === "true" || !process.env.OPENAI_API_KEY;
    if (useMock) {
      return NextResponse.json({ report: validateReport(createMockReport(chunks, project), chunks, project), mode: "mock" });
    }

    const compactEvidence = chunks
      .map((chunk) => `${chunk.id} | ${chunk.artifactName} lines ${chunk.lineStart}-${chunk.lineEnd}: ${chunk.text}`)
      .join("\n")
      .slice(0, 16000);

    const artifactSummary = artifacts
      .map((artifact) => `${artifact.id}: ${artifact.name} (${artifact.kind}, ${artifact.type || "unknown"}, ${artifact.size} bytes)`)
      .join("\n");

    const prompt = `You are Verric, an AI pentest reporting studio and evidence readiness reviewer.

Your job is NOT just to write a short report. Your job is to decide whether the supplied evidence is enough for a professional penetration testing deliverable, identify what proof is missing, then draft a standards-style report section with enough detail for executives and engineers.

Project details:
${JSON.stringify(project, null, 2)}

Evidence artifacts:
${artifactSummary}

Rules:
- Return JSON only. No markdown. No code fences.
- Every factual report sentence must cite one or more exact evidence chunk IDs from the input.
- Before drafting, check readiness: project metadata, scope, affected assets, proof of concept, impact, CVSS rationale, and remediation.
- If a finding lacks concrete PoC, set finding.readiness to "needs_poc" and add a blocking gap with suggested evidence.
- If the evidence includes a request/response pair, screenshot artifact, terminal proof, scanner confirmation, or reproduction notes for the issue, treat that as valid PoC. Do NOT mark it needs_poc just because it does not include exploit code.
- For web findings, a Burp request/response pair plus tester note or screenshot is enough PoC for a professional report.
- Draft detailed PoC text. Include what request was made, what changed, what response proved, and why that validates the finding.
- Do not invent CVEs, exploit success, credentials, screenshots, data theft, business names, timelines, tools, or assets.
- If a claim may be useful but is not proven, put it in flaggedClaims and/or finding.gaps. Do not put unproven claims in polished findings.
- Keep the report professional: 2-5 findings, 2-4 executive summary paragraphs/sentences, detailed descriptions, concrete business/technical impact, and specific remediation steps.
- Use standards-style pentest language based on OWASP WSTG/PTES/NIST SP 800-115 conventions.
- Severity must be Critical, High, Medium, Low, Informational, or Review.
- reportReadiness is "ready" when confirmed findings have enough evidence for a client report. Unconfirmed hypotheses such as suspicious-but-unconfirmed SQL injection should be moved to flaggedClaims or a needs_poc finding, not used to block confirmed findings.
- Do not include vague claims like "lacks detailed exploitation steps" if the evidence already includes a request, response, and observed result. Be precise about what is actually missing.

CVSS scoring rules (mandatory):
- The CVSS base score MUST be consistent with the CVSS:3.1 vector you supply. Compute, do not guess.
- ALWAYS include all 8 base metrics in the vector, including the Scope metric "S:U" or "S:C". A vector without S: is invalid.
- Use the canonical order: AV/AC/PR/UI/S/C/I/A. Example: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
  Reference bands you must respect:
  - All metrics High and AV:N/AC:L/PR:N/UI:N (e.g. C:H/I:H/A:H) -> 9.8 Critical
  - C:H/I:L/A:N with AV:N/AC:L/PR:N/UI:N -> 8.2 High
  - C:H/I:H/A:N with AV:N/AC:L/PR:L/UI:N -> 8.1 High
  - C:H/I:N/A:N with AV:N/AC:L/PR:L/UI:N -> 6.5 Medium
  - C:L/I:N/A:N with AV:N/AC:L/PR:N/UI:N -> 5.3 Medium
  - C:L only with AV:N/AC:H/PR:N/UI:N -> 3.7 Low
- Severity bucket must follow the score: 9.0-10.0 Critical, 7.0-8.9 High, 4.0-6.9 Medium, 0.1-3.9 Low, 0.0 Informational.
- If you are unsure of the precise score, use a conservative score within the correct severity bucket and pick a vector that justifies it.

References rules (mandatory):
- The "references" array must align with the finding's actual category. Do NOT use "Security Misconfiguration" for access control issues, and do NOT use "Broken Access Control" for injection issues.
  - Broken Access Control / unauth admin / IDOR / privilege escalation: "OWASP Top 10 A01: Broken Access Control", optionally "CWE-285: Improper Authorization" or "CWE-639: IDOR"
  - SQL injection / command injection / XSS: "OWASP Top 10 A03: Injection", optionally "CWE-89: SQL Injection" or "CWE-79: XSS"
  - Crypto failures / weak TLS / weak hashing: "OWASP Top 10 A02: Cryptographic Failures"
  - Insecure design / business logic: "OWASP Top 10 A04: Insecure Design"
  - Security misconfiguration / exposed services / default creds / verbose errors: "OWASP Top 10 A05: Security Misconfiguration"
  - Vulnerable components / outdated software: "OWASP Top 10 A06: Vulnerable and Outdated Components"
  - Auth failures / weak session: "OWASP Top 10 A07: Identification and Authentication Failures"
  - SSRF: "OWASP Top 10 A10: Server-Side Request Forgery"
- 1-3 references per finding. Be specific and accurate.

Return this exact JSON shape:
{
  "project": { ...same project object... },
  "overallRisk": "High",
  "reportReadiness": "needs_poc",
  "readinessSummary": "...",
  "globalGaps": [{"id":"gap-global-001","type":"missing_scope","title":"...","message":"...","suggestedEvidence":["..."],"severity":"blocking"}],
  "executiveSummary": [{"id":"sum-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
  "keyRecommendations": [{"id":"rec-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
  "methodology": ["OWASP WSTG-inspired testing", "Evidence review", "Verric readiness validation"],
  "findings": [{
    "id":"VRC-001",
    "title":"...",
    "severity":"High",
    "cvss":"8.1",
    "cvssVector":"CVSS:3.1/... or N/A",
    "affectedAssets":["..."],
    "status":"Needs Review",
    "category":"Broken Access Control",
    "readiness":"needs_poc",
    "readinessSummary":"...",
    "gaps":[{"id":"gap-vrc-001-poc","type":"missing_poc","title":"Add PoC evidence","message":"...","suggestedEvidence":["Burp request/response", "Screenshot", "Reproduction steps"],"severity":"blocking"}],
    "description":[{"id":"vrc-001-desc-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
    "impact":[{"id":"vrc-001-impact-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
    "proofOfConcept":[{"id":"vrc-001-poc-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
    "remediation":[{"id":"vrc-001-rem-001","text":"...","evidenceIds":["ev-001"],"status":"grounded"}],
    "references":["OWASP Top 10 A01: Broken Access Control"]
  }],
  "remediationRoadmap": {"immediate":["..."],"shortTerm":["..."],"mediumTerm":["..."],"longTerm":["..."]},
  "flaggedClaims":[{"id":"flag-001","text":"...","reason":"...","relatedEvidenceIds":["ev-001"]}]
}

Evidence chunks:
${compactEvidence}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Verric's evidence readiness reviewer and professional pentest report drafter. Return strict JSON only."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.15,
        max_tokens: 5200,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI readiness review failed", errorText);
      return NextResponse.json({ report: validateReport(createMockReport(chunks, project), chunks, project), mode: "mock" });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ report: validateReport(createMockReport(chunks, project), chunks, project), mode: "mock" });
    }

    const parsed = JSON.parse(extractJson(content)) as VerricReport;
    const validated = validateReport(parsed, chunks, project);
    try {
      await verifyGrounding(validated, chunks);
    } catch (groundingError) {
      console.error("verifyGrounding failed (non-fatal)", groundingError);
    }
    return NextResponse.json({ report: validated, mode: "openai" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Verric readiness review failed." }, { status: 500 });
  }
}
