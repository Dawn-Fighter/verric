# Verric — Innovations & Competitive Edge

This document catalogs what is genuinely novel in Verric, why each piece matters in the real world, and where competing approaches fall short. For product context see [`01-VISION-AND-PRODUCT.md`](./01-VISION-AND-PRODUCT.md); for implementation detail see [`02-ARCHITECTURE-AND-ENGINE.md`](./02-ARCHITECTURE-AND-ENGINE.md).

---

## 0. The framing: Verric sells *trust*, not *text*

The entire AI-for-security space is crowded with tools that **generate**. Verric's category is different: it is a **trust layer for AI-generated technical documents** in a domain where one fabricated claim is a business-ending event. Every innovation below exists to serve a single thesis:

> **Don't ask the user to trust the AI. Show the proof behind every line — and remove the lines you can't prove.**

That reframing — from "generation quality" to "provable credibility" — is the foundational innovation. Everything else is the machinery that makes it real.

---

## 1. Independent second-pass grounding verification

**What it is.** After the model drafts the report, a *separate* LLM call (`verifyGrounding`) re-examines every factual claim against the specific evidence it cited and returns a verdict: **supported / partial / unsupported**.

**How it works.** `collectClaims` gathers only observational claims (exec summary, finding description/impact/PoC). Each is sent as `{ claimText, citedEvidenceText[] }` to a temperature-0, JSON-mode call with a precise rubric. Verdicts mutate claim status in place: supported → `grounded`, partial → `needs_review` (with a reason), unsupported → `flagged` (pulled from the body). The call is try/catch-wrapped so it can never break generation.

**Why it matters.** Almost every "AI cites its sources" feature is **self-citation** — the same model that wrote the sentence also asserts it's supported, which is circular and unreliable. Verric breaks the circularity with an **independent audit**. This is the difference between "the AI said it's fine" and "a second, independent check confirmed the evidence actually backs this exact sentence."

**Real-world impact.** This is the mechanism that lets a firm put generated text in front of a paying client. It converts the unbounded risk of hallucination into a bounded, visible, reviewer-friendly signal.

**Where competitors fall short.** Generic LLM chat does self-citation at best. Report platforms leave verification entirely to the human. No mainstream pentest-reporting tool runs an independent grounding audit and *acts on the verdict* by partitioning content.

---

## 2. Hover-to-source provenance (claims are first-class, citable objects)

**What it is.** Every factual sentence in the studio is a `ReportClaim` carrying `evidenceIds`. Hovering a claim lights up the exact source chunk(s) in the Evidence Inspector.

**How it works.** Evidence is decomposed into atomic `EvidenceChunk`s with stable IDs (`ev-001`…). Claims reference those IDs; the UI's `selectClaim` drives highlight state. The same IDs are threaded into the PDF/DOCX evidence appendices.

**Why it matters.** Provenance turns the report from an opaque wall of prose into an **auditable artifact**. When a client pushes back — "where did this come from?" — the answer is one hover, or one appendix lookup, away.

**Real-world impact.** Massively reduces QA and client-defense time, and makes junior-authored reports reviewable by seniors at a glance.

**Where competitors fall short.** Generated prose elsewhere is typically unattributed. Even where tools attach references, they rarely make the **sentence ↔ exact-evidence-line** link interactive and carry it all the way into the exported deliverable.

---

## 3. Computed CVSS 3.1 — the vector is the single source of truth

**What it is.** A pure-TypeScript CVSS 3.1 base-score engine (`cvssFromVector`). `validateReport` always **recomputes** the score and severity from the vector.

**How it works.** Full metric weight tables (with scope-dependent PR), the official ISS/Impact/Exploitability formulas, and the spec's roundup-to-one-decimal — then `severityFromScore` derives the band. A malformed vector returns `null` and falls back gracefully rather than emitting a wrong number.

**Why it matters.** "Score says 9.8 Critical, vector says `C:L/I:N/A:N`" is a classic, credibility-destroying inconsistency in both hand-written and naively-generated reports. By **deriving** score and severity from the vector in code, Verric makes that contradiction **structurally impossible**.

**Real-world impact.** Clients and QA reviewers trust the numbers. No more silent CVSS arithmetic errors that undermine the whole report.

**Where competitors fall short.** LLMs are notoriously unreliable at multi-step arithmetic; tools that let the model emit the score directly inherit that unreliability. Verric refuses to trust the model's number at all.

---

## 4. The three-tier honesty gate

**What it is.** A consistent partitioning that keeps unproven material out of the client-facing body:

1. **Confirmed findings** → polished body.
2. **Unconfirmed observations** → "Items Requiring Validation."
3. **Unsupported claims** (flagged by grounding) → "Claims Pending Independent Verification."

**How it works.** `isUnconfirmedFinding` classifies findings by readiness + language heuristics; the grounding verdicts classify individual claims; the same rules are applied across PDF, DOCX, and the studio.

**Why it matters.** The dangerous failure mode of AI reporting isn't "the text reads badly" — it's "a plausible-but-unproven claim ships looking exactly like a proven one." Verric makes the **proven/unproven boundary explicit and structural**, not a matter of the reader's vigilance.

**Real-world impact.** A reviewer instantly sees what's solid versus what needs another look, instead of having to audit every sentence for overstatement.

**Where competitors fall short.** Generators produce a single undifferentiated block of text. The burden of separating proven from speculative falls entirely on the human.

---

## 5. Structured evidence parsing → semantic, groundable chunks

**What it is.** Raw tool output is parsed into structured facts before the model sees it. The shipped example is a real nmap `-sV` parser (`parseNmap`) that also emits semantic chunks.

**How it works.** `buildEvidenceChunks` emits, on top of raw line chunks, one **fact-shaped** chunk per parsed port: `Nmap: 10.10.10.5 port 3306/tcp open mysql — MySQL 5.7.31`. The model grounds claims against a clean fact, not a noisy raw line; the same parse powers a Hosts & Services table in the UI.

**Why it matters.** Grounding quality is bounded by evidence quality. Giving the model **pre-digested facts** with stable citation handles makes both drafting and verification sharper and reduces ambiguity in what a citation means.

**Real-world impact.** Better, more defensible citations; a tester *sees* their scan understood correctly before any AI runs.

**Where competitors fall short.** Dumping raw logs into a prompt yields fuzzy, line-noise citations. Verric's chunking is evidence engineering, not just text stuffing.

---

## 6. Deterministic, hand-grounded fallback

**What it is.** `createMockReport` builds a fully-grounded, realistic report **in code** from the actual uploaded chunks — no LLM required.

**How it works.** It matches real evidence with an `ids()` helper, attaches it to encoded claims (unauth admin panel, MySQL exposure, version disclosure), and even demonstrates the honesty model by flagging an unproven CVE claim. It's the initial UI state, the `USE_MOCK_REPORT` path, the no-key path, **and** the catch-block when an OpenAI call fails.

**Why it matters.** Two payoffs: (1) **the demo never breaks** — a dead network or missing key still yields a credible, grounded report; (2) it's a **reference implementation** of what "correctly grounded" looks like, which keeps the whole pipeline honest.

**Real-world impact.** Resilience. Offline or degraded environments still produce something usable instead of an error screen — which matters in air-gapped or restricted client environments.

**Where competitors fall short.** Most LLM tools hard-fail without connectivity/keys; few ship a deterministic, evidence-matched analogue of their AI output.

---

## 7. Consulting-grade export fidelity

**What it is.** PDF, DOCX, and TXT outputs that look like real consulting deliverables — cover page, exec summary, scope & methodology, risk-rating methodology, severity distribution, findings summary, detailed findings, evidence appendix with embedded screenshots, disclaimer.

**How it works.** `@react-pdf/renderer` builds a multi-page A4 document with controlled typography, fixed footers, and monospace CVSS vectors; `docx` builds the Word equivalent with tables, shading, and decoded inline screenshots; both apply the same honesty partitioning.

**Why it matters.** The deliverable **is** the product. A grounded report that exports as an ugly text dump won't be sent to a client. Verric's outputs are presentation-ready.

**Real-world impact.** The tester's job ends at "review and sign off," not "reformat into our template."

**Where competitors fall short.** Raw LLM output is markdown at best; achieving consulting-grade, multi-format fidelity with embedded evidence is real engineering most generators skip.

---

## 8. Anti-hallucination prompt engineering as policy

**What it is.** The drafting prompt encodes domain rules as hard policy: cite exact IDs, treat request/response/screenshot/scanner output as valid PoC (don't over-demand exploit code), never invent CVEs/credentials/outcomes, full canonical CVSS vectors with reference bands, and category-accurate OWASP/CWE references.

**Why it matters.** This encodes **how an experienced consultant actually reasons** about evidence sufficiency and severity — not generic "write a security report" instructions. It's the difference between a tool built by people who've shipped these reports and a generic wrapper.

**Where competitors fall short.** Thin prompt wrappers don't encode the nuanced rules (e.g. what counts as adequate PoC, or matching references to the actual vulnerability class) that keep findings credible.

---

## 9. Competitive landscape (summary)

| Capability | Generic LLM chat | Report platforms (PlexTrac/Dradis-class) | "Pentest GPT" assistants | **Verric** |
|---|---|---|---|---|
| Drafts a full report from raw evidence | ◑ (manual prompting) | ✗ (human writes) | ✗ (attack-phase focus) | ✅ |
| Per-claim provenance to exact evidence | ✗ | ◑ (manual refs) | ✗ | ✅ |
| **Independent** grounding verification | ✗ (self-citation) | ✗ | ✗ | ✅ |
| Computed CVSS (vector = source of truth) | ✗ | ◑ (calculators, manual) | ✗ | ✅ |
| Unproven content partitioned out | ✗ | ✗ | ✗ | ✅ |
| Structured evidence parsing → groundable chunks | ✗ | ◑ (importers) | ✗ | ✅ |
| Consulting-grade multi-format export | ✗ | ✅ | ✗ | ✅ |
| Deterministic offline fallback | ✗ | n/a | ✗ | ✅ |

`✅ yes · ◑ partial/manual · ✗ no` (assessment by capability class, not a specific vendor benchmark.)

---

## 10. The moat (why this is defensible)

Any single feature here is copyable. The defensibility is in **three layers that are hard to assemble together credibly:**

1. **An integrated trust pipeline.** Provenance, independent grounding, computed scoring, and honesty partitioning are threaded through one consistent data model from generation to every export format. Bolting one of these onto a generator is easy; making them cohere into a system a security professional *actually trusts* is the hard part.
2. **Encoded domain judgment.** The rules about evidence sufficiency, valid PoC, CVSS consistency, and reference accuracy reflect lived report-writing experience. That judgment is the product's "secret recipe," not the model.
3. **Category positioning.** Verric defines itself as a **trust layer**, not a generator. As models commoditize, "make AI provably honest in high-stakes documents" becomes more valuable, not less — and the grounding engine generalizes (SOC write-ups, security-annotated code docs) without changing its core.

---

## 11. Why it matters beyond pentesting

The grounding engine answers a general question: *"how do you let a generative model write a high-stakes technical document without shipping a fabrication?"* That question recurs in:

- **SOC / incident response write-ups** — same need to ground every claim in log/telemetry evidence.
- **Compliance and audit artifacts** — where unprovable statements are a regulatory hazard.
- **Security-annotated code documentation** — living docs whose security flags must trace to real code evidence.

Verric is the first concrete, working instance of that trust layer, aimed at the market that feels the pain most acutely today: penetration test reporting.

---

## 12. The bottom line

Verric's innovation is not that it writes faster. It's that it makes a generative model **prove its work, get independently audited, compute its numbers, and surrender anything it can't substantiate** — and then renders the result as a deliverable a consultant can sign their name to. In a domain where trust was the real bottleneck, that is the thing that actually unblocks adoption.
