# Verric Documentation

Deep documentation for Verric — the evidence-grounded pentest reporting engine. **Pentest reports you can prove.**

| Doc | What's inside |
|---|---|
| [01 — Vision & Product](./01-VISION-AND-PRODUCT.md) | The problem, the thesis ("proof before polish"), who it's for, real-world workflows, the competitive landscape, the moat, business value, honest limitations, and the roadmap. |
| [02 — Architecture & Engine](./02-ARCHITECTURE-AND-ENGINE.md) | The full A→Z technical reference: stack, data model, the parse → chunk → draft → validate → ground → score pipeline, the CVSS engine, the grounding pass, the three export renderers, and the production deployment. |
| [03 — Innovations & Competitive Edge](./03-INNOVATIONS-AND-COMPETITIVE-EDGE.md) | Every genuine innovation — what it is, how it works in code, why it matters in the real world, and where competing approaches fall short — plus the defensibility/moat analysis. |

## The 60-second version

Reporting can eat up to ~60% of a penetration test engagement, and teams won't let generative AI near the deliverable because one hallucinated finding, wrong CVSS score, or invented impact ships a liability to a paying client. **The bottleneck was never speed — it was trust.**

Verric solves trust with an integrated pipeline:

1. **Ingest the chaos** — raw nmap, Burp, sqlmap, logs, screenshots, notes. No templates required.
2. **Decompose into citable claims** — every factual sentence carries the exact `evidenceIds` behind it.
3. **Draft a professional report** — structured findings, executive summary, remediation, **CVSS computed from the vector** so score/vector/severity can never disagree.
4. **Independently verify** — a *second* LLM pass audits each claim against its cited evidence (supported / partial / unsupported).
5. **Refuse to ship the unprovable** — confirmed findings go in the body; unconfirmed observations and unsupported claims are partitioned into clearly-labeled review sections.
6. **Export** — consulting-grade PDF / DOCX / TXT, with the honesty partitioning baked in.

It doesn't ask you to trust the AI. It shows the proof behind every line — and removes the lines it can't prove.

> Built by Team Stratosix · Submitted to HackArena 2.0 — Hyderabad Zonals.
