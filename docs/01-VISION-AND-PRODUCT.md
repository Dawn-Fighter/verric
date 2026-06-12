# Verric — Vision & Product

> **Pentest reports you can prove.**
> Drop the raw mess of a finished engagement. Get a client-ready report where every claim is traceable to its evidence — and anything the AI can't prove is flagged, never shipped.

This document is the "why." It covers the problem, the thesis, who Verric is for, how it's used in the real world, the competitive landscape, and where the product is going. For the "how," see [`02-ARCHITECTURE-AND-ENGINE.md`](./02-ARCHITECTURE-AND-ENGINE.md). For the defensible differentiators, see [`03-INNOVATIONS-AND-COMPETITIVE-EDGE.md`](./03-INNOVATIONS-AND-COMPETITIVE-EDGE.md).

---

## 1. The one-sentence pitch

Verric is an evidence-grounded reporting engine that turns the raw output of a penetration test — nmap dumps, Burp request/response pairs, sqlmap logs, terminal scrollback, screenshots, and rough notes — into a professional, client-ready report in which **every factual sentence is linked to the exact evidence behind it**, and **anything the AI cannot prove is automatically pulled out of the deliverable** and surfaced for human review.

It is not "AI that writes reports." It is **AI that is forced to prove every line it writes**.

---

## 2. The problem

### 2.1 Reporting is the tax on every engagement

In professional offensive security, the actual hacking is only half the job. The other half — often **up to 60% of the billable hours on an engagement** — is writing the report. A penetration test that found nothing is worthless to a client; a penetration test that found everything but was never written up credibly is *also* worthless. The report **is** the product.

Report writing is slow, repetitive, and cognitively expensive:

- Re-reading scrollback to reconstruct what actually happened.
- Re-deriving CVSS vectors and scores by hand (and getting them subtly wrong).
- Translating raw tool output into executive language without losing technical precision.
- Formatting everything into a consulting-grade deliverable: cover page, executive summary, scope, methodology, severity distribution, per-finding detail, evidence appendix, disclaimer.

### 2.2 The obvious fix — "just use an LLM" — is a trap

Large language models are extremely good at producing fluent, professional-sounding security prose. So why hasn't AI already eaten this market?

**Because the bottleneck was never speed. It's trust.**

A penetration test report is a legal and commercial artifact. A client makes remediation decisions, budget decisions, and sometimes compliance attestations based on it. If an AI:

- **hallucinates a finding** that was never demonstrated,
- **invents a CVE** or an exploitation outcome that didn't happen,
- **assigns a CVSS score that contradicts its own vector**, or
- **fabricates an impact** ("full account takeover") that the evidence doesn't support —

…then the consultancy has shipped a **liability** to a paying client. One hallucinated line can cost a firm its credibility, its client, and potentially expose it legally. That risk is so unacceptable that most serious teams simply **won't let a generative model near the deliverable** — even though they desperately want the time back.

### 2.3 The real problem statement

> The pentest reporting bottleneck is not "writing is slow." It is **"we cannot trust generated text in a document where a single fabricated claim is a business-ending event."**

Solve trust, and the speed gain follows. That is the entire premise of Verric.

---

## 3. The thesis: proof before polish

Most AI security tools optimize for **polish** — make the text read well. Verric inverts the priority: **proof first, polish second.**

The core design commitments:

1. **Every factual claim must cite its evidence.** Each generated sentence carries a list of `evidenceIds` pointing to exact source chunks.
2. **The model's self-citation is not trusted.** A *second, independent* LLM pass re-checks whether the cited evidence actually supports each sentence.
3. **Scores are computed, not guessed.** The CVSS base score is calculated in code from the vector, so score, vector, and severity can never disagree.
4. **Unproven material never reaches the client.** Confirmed findings go in the body; unconfirmed observations and unsupported claims are partitioned into clearly-labeled "needs validation" sections.
5. **The tool degrades safely.** If the AI is unavailable, a deterministic, hand-grounded report is produced instead, so a live demo or a real workflow never collapses into an error screen.

The product's emotional promise to the user is: **"You don't have to trust the AI. You can see the proof behind every line — and we already removed the lines we couldn't prove."**

---

## 4. What Verric actually is (the product)

Verric is a web application — a **reporting studio** — structured as a five-step workflow:

| Step | Name | What happens |
|---|---|---|
| 01 | **Project Setup** | Capture the engagement brief: client, scope, dates, methodology, tester, classification. This is what makes the export feel like a real consulting deliverable rather than a tool dump. |
| 02 | **Evidence Intake** | Drop up to 10 raw artifacts (nmap, Burp, sqlmap, HAR, JSON, XML, logs, screenshots, PDFs, Markdown notes) plus free-form manual notes. Verric parses what it can (e.g. nmap → a structured Hosts & Services table). |
| 03 | **Verric Review** | The core layer. The AI reviews the evidence and tells the tester **what is missing** before a report can ship — missing PoC, missing CVSS rationale, unsupported claims, missing project detail — as a per-finding readiness checklist. |
| 04 | **Report Draft** | The client-ready draft: executive summary, findings summary, per-finding detail. Every claim is hover-to-source: hover a sentence and the exact evidence chunk lights up. Unverified claims wear an inline `⚠` badge. |
| 05 | **Export** | One-click PDF, DOCX, or TXT — formatted to match a real consulting deliverable, with the honesty partitioning baked in. |

The defining experience is **Step 03 (Review)** and the **provenance + grounding** woven through Steps 04–05. That is where Verric stops being "a generator" and becomes "a reviewer that happens to also draft."

---

## 5. Who it's for

### 5.1 Primary persona — the boutique / mid-size pentest firm

Small and mid-size offensive security consultancies live and die on throughput and reputation. They run many engagements with a lean team. For them Verric is:

- **Time back:** the reporting tax drops dramatically because the first credible draft is automatic.
- **Reputation insurance:** the grounding gate means a junior consultant can't accidentally ship a hallucinated or overstated finding.
- **Consistency:** every report comes out in the same professional structure with computed scores.

### 5.2 The solo consultant / freelancer

A one-person shop has no second reviewer. Verric *is* the second reviewer — it independently checks every claim against evidence and tells the consultant exactly what proof is still missing.

### 5.3 Internal red / purple teams

In-house teams reporting to their own security leadership need fast, credible, repeatable write-ups. The grounding trail also makes findings auditable: "show me the evidence for this claim" is one hover away.

### 5.4 Adjacent (roadmap) personas

- **SOC analysts** writing incident write-ups (same grounding engine, different input).
- **Engineering teams** wanting security-annotated, evidence-traceable living documentation of a codebase.

---

## 6. Real-world use: a concrete walkthrough

Consider the bundled demo engagement (`demo-complete-evidence-pack/`), which mirrors a real external web-app test. The tester finishes the engagement with a folder of mess:

```
01-nmap-external-scan.txt              # service enumeration
02-burp-admin-unauthenticated-poc.http # /admin returns 200 without auth
03-burp-idor-user-export-poc.http      # IDOR on a user-export endpoint
04-sqlmap-login-confirmed.txt          # confirmed SQLi from sqlmap
05-login-sqli-request-response.http    # manual true/false request/response proof
06-tester-notes.md                     # rough hypotheses and context
07-admin-panel-screenshot.png          # visual PoC
08-idor-response-screenshot.png        # visual PoC
09-sqlmap-confirmed-screenshot.png     # visual PoC
10-api-export-response.json            # raw API response
```

**Without Verric:** the tester spends hours reconstructing the narrative, hand-writing findings, hand-deriving CVSS, formatting a Word document, and proofreading for overstatement.

**With Verric:**

1. They fill the brief (Step 01) once.
2. They drag all 10 files into the drop zone (Step 02). Verric parses the nmap output into a Hosts & Services table on the spot.
3. They click **Run Verric Review** (Step 03). The engine:
   - drafts structured findings (unauth admin panel, IDOR, SQL injection, MySQL exposure),
   - computes CVSS from each vector,
   - maps every sentence to evidence,
   - runs a **second independent grounding pass**,
   - and produces a per-finding readiness checklist: *affected asset ✓, CVSS rationale ✓, description evidence ✓, PoC ✓, impact ✓, remediation ✓.*
   Because this pack contains confirmed sqlmap output **and** manual request/response proof **and** screenshots, no finding is flagged "needs PoC."
4. They review the draft (Step 04), hovering claims to confirm provenance, and read the inline grounding badges.
5. They export a PDF/DOCX (Step 05). Confirmed findings are in the polished body; anything the grounding pass couldn't confirm is in a clearly-labeled "Claims Pending Independent Verification" section — visible to the reviewer, never silently shipped.

The output is a deliverable the consultant can stand behind, produced in minutes, with an evidence trail for every line.

---

## 7. Why this is competitive

### 7.1 The landscape

| Category | Examples (class of tool) | What they do well | Where they fall short for this job |
|---|---|---|---|
| **Generic LLM chat** | ChatGPT, Claude, etc. | Fluent prose, fast | No provenance, no grounding check, invents CVEs/impacts, no computed CVSS, no professional export, no honesty gate. Self-citation only. |
| **Report-management platforms** | PlexTrac / Dradis / AttackForge-style | Templating, finding libraries, collaboration, exports | Human still writes every word; AI features (where present) are generative, not *grounded* and *independently verified*. The trust problem is unsolved. |
| **"Pentest GPT" assistants** | LLM agents for offensive tasks | Help *do* the testing / suggest commands | Aimed at the attack phase, not the credibility-critical reporting deliverable. |
| **Verric** | — | **Grounds and independently verifies every claim, computes CVSS, partitions unproven material out of the deliverable, and exports consulting-grade documents.** | Scope is deliberately focused on the reporting/credibility layer (by design). |

### 7.2 The differentiation in one line

Everyone else makes the AI **write**. Verric makes the AI **prove**, then makes a **second AI check the proof**, then **removes what fails the check** before a human ever exports it.

### 7.3 Why it's defensible (the moat)

The defensibility isn't the prompt — prompts are copyable. It's the **trust-engineering system** around the model:

1. **Provenance data model** — claims are first-class objects with `evidenceIds`, threaded from generation through validation, UI, and every exporter.
2. **Independent grounding pass** — a separate, temperature-0 verification call with a strict supported/partial/unsupported rubric, mapped onto claim status.
3. **Computed scoring** — a pure-TypeScript CVSS 3.1 engine that makes score/vector/severity internally consistent by construction.
4. **Honesty partitioning** — confirmed vs. unconfirmed findings, verified vs. unverified claims, enforced consistently across PDF/DOCX/TXT.
5. **Structured evidence parsing** — turning raw tool text into semantic chunks the model can ground against, not just blobs.

Each piece is individually buildable; the **product value is in their integration into a single honest pipeline that a security professional will actually trust.** That integration, plus domain credibility ("we've written these reports by hand"), is the moat.

---

## 8. The value, quantified

- **Time:** reporting can consume up to ~60% of an engagement. Automating the credible first draft attacks the single largest non-billable-feeling cost in the business.
- **Risk:** the grounding gate converts "hope nobody hallucinated" into "the system removed anything it couldn't prove." That is risk *reduction*, not just speed.
- **Consistency & onboarding:** junior testers produce senior-grade, consistently-structured reports because the engine enforces structure, scoring, and an evidence trail.
- **Auditability:** every claim's evidence is one hover (or one appendix lookup) away — useful for QA, client pushback, and internal review.

---

## 9. Honest limitations (what Verric is *not*)

Credibility requires naming the boundaries:

- Verric does **not** perform the penetration test. It reports on evidence you supply.
- Grounding verification reduces hallucination risk dramatically but is itself an LLM judgment; **a human reviewer is still in the loop by design** — the product surfaces uncertainty rather than hiding it.
- It currently parses nmap plain-text into structure; other formats are ingested as text/semantic chunks (richer structured parsers are on the roadmap).
- PDF/screenshot artifacts are treated as evidence references, not OCR'd.
- The exported document is a strong first draft plus an honesty report — it is meant to be reviewed and signed off by the testing team, not blindly shipped.

These aren't weaknesses to hide; they are the reason the design keeps a human in control and makes uncertainty visible.

---

## 10. Vision & roadmap

Verric's grounding engine is general. "Map claims to evidence, independently verify them, and refuse to ship the unprovable" applies far beyond pentest reports.

| Horizon | Focus |
|---|---|
| **Now** | The pentest report engine: raw evidence → grounded, client-ready report (PDF/DOCX/TXT). |
| **Next** | More structured parsers (Burp XML, Nessus `.nessus`, Nuclei JSONL); **SOC incident write-ups** using the same grounding engine; richer reviewer collaboration. |
| **Later** | **Security-annotated code documentation** — point the engine at a repository to produce living docs with traceable, evidence-backed security flags. |

The throughline: **a trust layer for AI-generated technical documents in domains where a single fabricated claim is unacceptable.**

---

## 11. Why this team

Verric was built by people who have **written these reports by hand**. They know what a credible finding looks like, where the CVSS math goes wrong, and exactly where an AI must be kept on a leash. The product is not a guess at a problem from the outside — it encodes lived domain knowledge into a system that keeps generative AI honest.

> Built by Team Stratosix. Submitted to HackArena 2.0 — Hyderabad Zonals.
