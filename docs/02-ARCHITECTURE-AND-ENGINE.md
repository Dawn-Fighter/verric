# Verric — Architecture & Engine (A → Z)

This is the complete technical reference: the stack, the data model, the engine pipeline, the grounding system, the export renderers, and the production deployment. For the product rationale see [`01-VISION-AND-PRODUCT.md`](./01-VISION-AND-PRODUCT.md); for the defensible innovations see [`03-INNOVATIONS-AND-COMPETITIVE-EDGE.md`](./03-INNOVATIONS-AND-COMPETITIVE-EDGE.md).

---

## 1. Stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | One codebase for the studio UI and the server-side API routes (LLM calls, document rendering). Server routes keep the OpenAI key off the client. |
| UI | **React 19 + TypeScript 5.7** | Strong typing across the entire claim/evidence data model — provenance is type-checked end to end. |
| Styling | **Tailwind 3** with a custom editorial palette | A deliberate "consulting deck" aesthetic (paper/ink/serif), not a generic SaaS look. |
| LLM | **OpenAI Chat Completions** (`gpt-4o-mini` default) | Used for **both** drafting and the independent grounding pass. |
| PDF | **`@react-pdf/renderer`** | Multi-page, typographically controlled PDF built from React components. |
| DOCX | **`docx`** | Programmatic Word documents with tables, shading, embedded images. |
| Core logic | **Pure TypeScript** (no deps) | CVSS 3.1 scorer and nmap parser are dependency-free and unit-testable. |

Runtime note: all API routes declare `export const runtime = "nodejs"` because PDF/DOCX rendering and the OpenAI fetch require the Node runtime (not edge).

---

## 2. Repository map

```
src/
├── app/
│   ├── page.tsx                      # The 5-step studio (client component, all UI state)
│   ├── layout.tsx                    # Root layout, fonts (Cormorant Garamond, IBM Plex Sans/Mono)
│   ├── globals.css                   # Theme tokens
│   └── api/
│       ├── generate-report/route.ts  # LLM draft + validateReport + verifyGrounding (2nd pass)
│       ├── export-pdf/route.tsx       # Multi-page React-PDF renderer
│       ├── export-docx/route.ts       # docx renderer
│       └── export-txt/route.ts        # Plain-text renderer
└── lib/
    └── report.ts                     # Types, CVSS engine, nmap parser, chunker,
                                       # validateReport, deterministic mock report,
                                       # renderPlainTextReport
demo-evidence-pack/                    # Minimal demo artifacts
demo-complete-evidence-pack/           # 10 artifacts for the full demo flow
deploy/
└── verric.cyberkunju.com.conf         # nginx reverse-proxy vhost (production)
Dockerfile                             # Multi-stage, Next.js standalone output
docker-compose.yml                     # One-command deploy, runtime secrets, healthcheck
```

`src/lib/report.ts` is the heart of the system. It is shared by the client studio **and** every server route, which is why the data model and scoring stay perfectly consistent across UI, generation, and all three export formats.

---

## 3. The data model

Everything flows through a small set of strongly-typed structures defined in `report.ts`.

### 3.1 Evidence

```ts
type EvidenceKind = "text" | "json" | "xml" | "image" | "pdf" | "notes" | "unknown";

type EvidenceArtifact = {            // a single uploaded file (or manual notes)
  id: string; name: string; kind: EvidenceKind;
  type: string; size: number;
  content?: string;                  // text content (parsed/sliced)
  preview?: string;                  // data URL for images
};

type EvidenceChunk = {               // an atomic, citable unit of evidence
  id: string;                        // "ev-001", "ev-002", … — the citation handle
  artifactId: string; artifactName: string;
  lineStart: number; lineEnd: number;
  text: string;
};
```

The `EvidenceChunk.id` is the linchpin of the whole system: it is the **handle every claim cites**. Provenance is literally "a claim holds a list of these IDs."

### 3.2 Claims

```ts
type ClaimStatus = "grounded" | "needs_review" | "flagged";

type ReportClaim = {
  id: string;
  text: string;                      // one factual sentence
  evidenceIds: string[];             // exact chunks that back it
  status: ClaimStatus;               // set by validation + grounding pass
  groundingNote?: string;            // one-line reason when not fully grounded
};
```

`ReportClaim` is the unit of trust. A finding is not a blob of text — it's arrays of claims, each independently citable and independently verifiable.

### 3.3 Findings, gaps, and the report

```ts
type Finding = {
  id: string; title: string;
  severity: Severity;                // Critical | High | Medium | Low | Informational | Review
  cvss: string; cvssVector: string;  // score is recomputed from the vector
  affectedAssets: string[];
  status: "Open" | "Ready for Report" | "Needs Review" | "Blocked";
  category: string;
  readiness: "ready" | "needs_poc" | "needs_details" | "unsupported";
  readinessSummary: string;
  gaps: EvidenceGap[];               // what's missing before this can ship
  description: ReportClaim[];
  impact: ReportClaim[];
  proofOfConcept: ReportClaim[];
  remediation: ReportClaim[];
  references: string[];
};

type EvidenceGap = {                 // a named "what proof is missing" item
  id: string; type: /* missing_poc | missing_cvss | unsupported_claim | … */;
  title: string; message: string;
  suggestedEvidence: string[];       // concrete artifacts that would close the gap
  severity: "blocking" | "warning" | "info";
};

type VerricReport = {
  project: ProjectDetails;
  overallRisk: Severity;
  reportReadiness: ReadinessStatus;
  readinessSummary: string;
  globalGaps: EvidenceGap[];
  executiveSummary: ReportClaim[];
  keyRecommendations: ReportClaim[];
  methodology: string[];
  findings: Finding[];
  remediationRoadmap: { immediate; shortTerm; mediumTerm; longTerm: string[] };
  flaggedClaims: FlaggedClaim[];
};
```

The shape is deliberately the shape of a **real penetration test report** — exec summary, methodology, findings with description/impact/PoC/remediation, a remediation roadmap, and references — but with every prose element decomposed into citable, verifiable claims.

---

## 4. The engine pipeline

The journey from raw files to a grounded report is a fixed pipeline. The "defensible work" is steps 3–6.

```
RAW EVIDENCE → 1. INGEST → 2. CHUNK → 3. DRAFT (LLM) → 4. VALIDATE → 5. GROUND (LLM #2) → 6. SCORE → OUTPUT
```

### 4.1 Ingestion & kind inference (`inferEvidenceKind`)

On upload (client side, `handleFiles` in `page.tsx`), each file's kind is inferred from extension/MIME:

- Images (`.png/.jpg/.jpeg`) → `image`, stored as a data-URL `preview` (for embedding in exports) plus a textual reference.
- `.pdf` → `pdf`, stored as a reference (not OCR'd).
- `.json/.har`, `.xml`, `.md`, and text/log/http types → text content, **sliced to 160,000 chars** to bound payloads.

Manual notes are injected as a synthetic `manual-notes.md` artifact.

### 4.2 The nmap parser (`isNmapContent`, `parseNmap`)

A real, dependency-free parser for nmap `-sV` plain-text output:

- `isNmapContent` cheaply sniffs the head of a file for the `Nmap scan report` / `PORT STATE SERVICE` table signature.
- `parseNmap` walks the lines, tracking the current host (`Nmap scan report for host (ip)`) and parsing each port row into `{ port, proto, state, service, version }`, producing structured `NmapHost[]`.

This is used in two places: the **UI** renders a Hosts & Services table in the Evidence Intake card, and the **chunker** emits one *semantic* chunk per port.

### 4.3 Chunking (`buildEvidenceChunks`)

This is where evidence becomes citable. For each artifact:

- **Images/PDFs** → a single descriptive chunk ("PNG artifact supplied: …").
- **nmap content** → in addition to raw lines, **one semantic chunk per parsed port**, phrased so the model can ground against a *fact* rather than a raw line:
  > `Nmap: 10.10.10.5 port 3306/tcp open mysql — MySQL 5.7.31`
- **All text** → one chunk per non-empty line, with `lineStart/lineEnd` recorded.

Chunks get sequential IDs (`ev-001`, `ev-002`, …) and the list is **capped at 180** to bound the token budget. These IDs are the citation vocabulary the LLM must use.

### 4.4 Drafting (the LLM, first pass — `generate-report/route.ts`)

The route builds a compact evidence listing (`ev-id | artifact lines x-y: text`, sliced to ~16,000 chars) and an artifact summary, then sends a long, rule-dense system+user prompt to the model with `temperature: 0.15`, `response_format: { type: "json_object" }`. The prompt enforces, among other things:

- **Every factual sentence must cite exact `evidenceIds`** from the input.
- **Readiness review before drafting**: if a finding lacks concrete PoC, set `readiness: "needs_poc"` and add a **blocking gap** with `suggestedEvidence`.
- **What counts as PoC**: a request/response pair, screenshot, terminal proof, scanner confirmation, or reproduction notes is valid PoC — do **not** demand exploit code.
- **No invention**: no fabricated CVEs, exploitation success, credentials, screenshots, data theft, business names, timelines, tools, or assets. Unproven-but-useful material goes to `flaggedClaims` / finding `gaps`, never into polished findings.
- **CVSS rules**: the score must be consistent with a full CVSS:3.1 vector that includes all 8 base metrics in canonical order (`AV/AC/PR/UI/S/C/I/A`), with explicit reference bands.
- **Reference rules**: the `references` array must match the finding's category (e.g. Broken Access Control → OWASP A01, not "Security Misconfiguration").

The model returns a `VerricReport`-shaped JSON object (`extractJson` strips any stray code fences).

### 4.5 Validation & normalization (`validateReport`)

Before anything is trusted, `validateReport` sanitizes the model output:

- Builds a set of **valid chunk IDs** and **strips any `evidenceId` the model cited that doesn't actually exist** (anti-hallucinated-citation).
- Normalizes every claim: a claim with zero valid evidence IDs is forced to `needs_review` (it cannot be "grounded" with no evidence).
- Normalizes gaps, findings, severity defaults, and roadmap shape.
- **Recomputes CVSS from the vector** (see 4.7) so score and severity are derived, never trusted from the model.
- Recomputes `reportReadiness` from whether any blocking gaps exist.

This step is the firewall between "what the model said" and "what the system will stand behind."

### 4.6 Independent grounding (the LLM, second pass — `verifyGrounding`)

This is the signature mechanism. After validation, a **separate** OpenAI call (temperature 0, JSON mode) audits the draft:

1. `collectClaims` gathers only **factual/observational** claims — executive summary + each finding's description, impact, and proof of concept. Prescriptive guidance (remediation, key recommendations) is **deliberately excluded**, because "use parameterized queries" is correct advice whether or not those exact words appear in the evidence.
2. For each claim, a compact payload is built: `{ claimId, text, evidence: [citedChunkText…] }` (evidence text truncated to 400 chars per chunk to bound tokens).
3. The verifier prompt asks a strict question — *does the cited evidence actually support this exact sentence?* — with a precise rubric:
   - **supported**: evidence directly proves it, or it's a conservative paraphrase / a standard impact that follows logically from the demonstrated condition.
   - **partial**: evidence is related but the claim adds unsupported specifics (extra severity, scope, conflated facts).
   - **unsupported**: a genuine factual leap (asserting exploitation when only access was shown, an unmentioned CVE, invented data exfiltration/takeover).
4. Verdicts are mapped back onto claim status, **mutating the report in place**:
   - `supported` → `grounded`, note cleared.
   - `partial` → `needs_review`, `groundingNote = "Verric: <reason>"`.
   - `unsupported` → `flagged`, `groundingNote = "Verric: <reason>"`.

Crucially, `verifyGrounding` is wrapped in try/catch by the caller — **a grounding failure never breaks report generation** (it just leaves validated statuses in place).

### 4.7 The CVSS 3.1 engine (`cvssFromVector`)

A pure, dependency-free CVSS 3.1 base-score implementation:

- Parses a `CVSS:3.1/AV:…/AC:…/PR:…/UI:…/S:…/C:…/I:…/A:…` vector; returns `null` if any required metric is missing (so a malformed vector falls back to the model's text, not a wrong number).
- Uses the official metric weight tables, with **scope-dependent Privileged Required weights** (`PR_U` vs `PR_C`).
- Computes ISS → Impact (scope-aware formula) → Exploitability → base score, applying the spec's **roundup-to-one-decimal** function (`roundUp1`) with float-safety.
- Maps score → severity band (`severityFromScore`): ≥9 Critical, ≥7 High, ≥4 Medium, >0 Low, else Informational.

Because `validateReport` always re-derives `cvss` and `severity` from `cvssVector`, **the score, the vector, and the severity label can never contradict each other** — a class of error that is endemic in hand-written and naively-generated reports.

### 4.8 Deterministic fallback (`createMockReport`)

`createMockReport` builds a fully-grounded report **in code** from whatever chunks are present, using an `ids()` helper to match real evidence (e.g. find the chunk mentioning `3306/tcp|mysql`) and attach it to the relevant claims. It encodes a realistic engagement (unauth admin panel, MySQL exposure, version disclosure) and even demonstrates the honesty model (it flags an unproven "specific CVE" claim).

It's used:

- as the **initial UI state** before any review runs,
- when `USE_MOCK_REPORT=true`,
- when **no OpenAI key** is configured, and
- when the **OpenAI call fails** (the route catches and returns the mock).

This is why a demo or a real session **never** collapses into an error — there is always a credible, grounded report to show.

---

## 5. Claim status lifecycle

```
                ┌───────────────────────────── grounded   (in polished body)
draft → validate ─ needs_review (partial) ──── needs_review (kept in body, ⚠ badge)
                └─ no/invalid evidence ──┐
                                         ↓
                         verifyGrounding overrides:
                            supported   → grounded
                            partial     → needs_review  (⚠ "unverified")
                            unsupported → flagged        (⚠ "unsupported", pulled from body)
```

The exporters and the UI treat `grounded` + `needs_review` as **"verified enough for the body"** and `flagged` as **"pull it out."** That single rule is applied identically in the studio, the PDF, and the DOCX.

---

## 6. The honesty partitioning (two/three tiers)

The deliverable is split so nothing shaky reaches the client unlabeled:

1. **Confirmed findings → polished body.** A finding is "unconfirmed" if its text matches `/potential|candidate|unconfirmed|not confirmed|requires further|no successful payload|needs poc/i` or its readiness is `needs_poc`/`unsupported` (`isUnconfirmedFinding`).
2. **Unconfirmed observations → "Items Requiring Validation."** Listed with the reason more proof is needed — visible, but not presented as proven vulnerabilities.
3. **Unsupported individual claims → "Claims Pending Independent Verification."** Claims the grounding pass flagged are removed from the polished prose and tabulated (source, statement, status, reviewer note).

This logic is implemented consistently in `export-pdf/route.tsx`, `export-docx/route.ts`, and reflected in `page.tsx`.

---

## 7. The studio UI (`page.tsx`)

A single client component holds all workflow state: `step`, `project`, `artifacts`, `manualNotes`, `report`, `mode` (`openai` | `mock`), `hasReviewed`, plus the active-claim selection that drives provenance highlighting.

Key behaviors:

- **`chunks` is derived** (`useMemo`) from artifacts + notes, so the citable evidence set is always in sync with what's uploaded.
- **`runVerricReview`** POSTs `{ project, artifacts, chunks }` to `/api/generate-report`, then re-runs `validateReport` on the response client-side for belt-and-suspenders consistency; on any failure it falls back to the mock and surfaces a friendly message.
- **Hover-to-source provenance:** each `ClaimBlock` calls `selectClaim` on hover/click, setting `activeEvidenceIds`; the Evidence Inspector highlights exactly those chunks.
- **Inline grounding badges:** claims with status `needs_review`/`flagged` render a `⚠ unverified`/`⚠ unsupported` badge carrying the `groundingNote` as a tooltip.
- **Readiness checklist per finding** (`FindingReviewCard`): affected asset, CVSS rationale, description evidence, PoC, impact, remediation — each shown Ready/Missing.
- **"New Report" reset:** clears the brief, evidence, notes, and draft back to the setup step (with a confirmation guard), resets the file input, and clears any saved draft from `localStorage`.

---

## 8. Export renderers

All three exporters consume the same `VerricReport` + `chunks` (+ `artifacts` for images) and apply the same honesty partitioning.

### 8.1 PDF (`export-pdf/route.tsx`, `@react-pdf/renderer`)

A six-section A4 document built from React components:

1. **Cover** — title, client, project metadata grid, overall risk.
2. **Summary** — executive summary (verified claims only), assessment overview counts, severity distribution, key recommendations, scope & methodology table.
3. **Risk Rating Methodology** — the severity → CVSS band → remediation-timeline table.
4. **Findings Summary** — confirmed findings table, plus "Items Requiring Validation" and "Claims Pending Independent Verification" tables, plus remediation priority.
5. **Detailed Findings** — per finding: spec table (asset, CVSS score, **CVSS vector in monospace**, references), description/impact/PoC/remediation claim lists, and key evidence excerpts.
6. **Evidence Appendix** — cited evidence excerpts table + embedded screenshot images + disclaimer.

A fixed footer (`classification · client`) is rendered on every page. `wrap={false}` is used on atomic blocks to avoid ugly page breaks.

### 8.2 DOCX (`export-docx/route.ts`, `docx`)

A programmatic Word document mirroring the PDF structure: cover paragraphs, document-control spec table, executive summary, key recommendations, scope & methodology, risk-rating table, findings summary, the two honesty sections, detailed findings, remediation roadmap, an evidence reference index, **embedded screenshot images** (decoded from data-URL previews via `imageDataFromDataUrl`), and a disclaimer. Styling uses a consistent palette (ink/red/muted) and monospace for vectors/evidence, matching real consulting typography.

### 8.3 TXT (`renderPlainTextReport` in `report.ts`)

A clean plain-text rendering (project header, exec summary, findings summary, per-finding detail including missing-evidence notes, evidence appendix). Generated **client-side** for instant download and as a dependency-free fallback if PDF/DOCX rendering ever fails.

---

## 9. Production deployment

The app is containerized and deployed behind an existing shared nginx + Cloudflare stack.

### 9.1 Container (`Dockerfile`, `docker-compose.yml`)

- **Multi-stage build** on `node:22-alpine`: `deps` (npm ci) → `builder` (`next build`) → `runner`.
- Uses **Next.js standalone output** (`output: "standalone"` in `next.config.mjs`), so the runtime image ships only the traced server + static assets — no full `node_modules`.
- Runs as a **non-root** `nextjs` user; `EXPOSE 3000`; `CMD ["node", "server.js"]`.
- `docker-compose.yml` injects secrets **at runtime** from `.env.local` (`OPENAI_API_KEY`, `OPENAI_MODEL`, `USE_MOCK_REPORT`) — never baked into the image — with `restart: unless-stopped` and a healthcheck.
- The healthcheck probes `http://127.0.0.1:3000/` (IPv4, busybox-`wget` compatible — `localhost` would resolve to IPv6 `::1`, which the IPv4-bound server doesn't answer).

### 9.2 Reverse proxy (`deploy/verric.cyberkunju.com.conf`)

The production host already serves another domain on one public IP. Verric coexists via **name-based virtual hosting**:

- nginx routes by `Host` header: `verric.cyberkunju.com` → the container on `127.0.0.1:3000`; the existing domain is untouched.
- The container binds to **localhost only**, so it is reachable **only** through nginx, never directly from the internet.
- TLS uses a **Cloudflare Origin Certificate** for `*.cyberkunju.com` (Cloudflare proxied, Full-strict), mirroring the existing site's pattern.
- `proxy_read_timeout` is raised (the `/api/generate-report` call to OpenAI can take ~25s).

### 9.3 Deploy flow

```bash
cd ~/verric && git pull && sudo docker compose up -d --build
```

The image rebuilds (the build runs on the ARM/Graviton host to match architecture), the container is recreated, and nginx continues serving with zero changes to the co-located domain.

---

## 10. Data-flow summary (one screen)

```
┌── Studio (page.tsx, client) ───────────────────────────────────────────────┐
│  Step 1 Setup → Step 2 Evidence (inferKind, parseNmap, buildEvidenceChunks) │
│                       │ POST { project, artifacts, chunks }                  │
└───────────────────────┼─────────────────────────────────────────────────────┘
                        ▼
┌── /api/generate-report (server) ───────────────────────────────────────────┐
│  mock? → createMockReport → validateReport ──────────────► return           │
│  live? → OpenAI draft (#1) → extractJson → validateReport                    │
│           → verifyGrounding (OpenAI #2, try/catch) → return                  │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        ▼  VerricReport (claims carry status + evidenceIds)
┌── Studio review/draft → hover-to-source, ⚠ badges, readiness checklists ─────┐
│  Export → /api/export-pdf | export-docx | (client) renderPlainTextReport     │
│  Honesty partitioning applied identically across all formats                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

The whole system is one consistent loop: **decompose into citable claims → draft → strip bad citations & compute scores → independently verify → partition the unprovable out → render.**
