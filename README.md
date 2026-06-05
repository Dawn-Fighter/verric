# Verric

**Pentest reports you can prove.**

Drop the raw mess of a finished engagement. Get a client-ready report where every claim is traceable to its evidence — and anything the AI can't prove is flagged, never shipped.

> Submitted to **HackArena 2.0 — Hyderabad Zonals** by Team Stratosix.

---

## The problem

Reporting eats up to 60% of a pentest engagement. Teams won't let AI fix it because one hallucinated finding, one wrong CVSS score, or one invented remediation ships a liability to a paying client.

The bottleneck isn't speed. It's trust.

## What Verric does differently

Most AI pentest tools generate text. Verric makes the AI prove every line.

1. **Ingest the chaos** — paste raw nmap output, Burp exports, sqlmap logs, terminal scrollback, screenshots, rough notes. No clean templates required.
2. **Draft the report** — structured findings, executive summary, computed CVSS scores, remediation guidance — written automatically in a professional consulting format.
3. **Prove every claim** — each sentence links to the exact evidence behind it. A second independent grounding pass labels each claim *supported / partial / unsupported*. Anything the AI can't prove is pulled out of the polished body and listed for reviewer attention.

It doesn't ask you to trust the AI. It shows the proof behind every line.

## Live features

- **Hover-to-source provenance.** Every claim in the studio carries `evidenceIds`. Hover a sentence → the exact source chunk lights up in the Evidence Inspector.
- **Independent grounding verification.** A second LLM pass re-checks every factual claim against its cited evidence. Verdicts (`supported / partial / unsupported`) are mapped onto claim status and surfaced as inline `⚠` badges with reasons.
- **Computed CVSS 3.1.** Score is calculated from the vector in code (`cvssFromVector`), so the score, vector, and severity can never disagree.
- **Real Nmap parser.** Plain-text `-sV` output is parsed into a structured Hosts & Services table — visible in the Evidence Intake card and emitted as semantic chunks the LLM can ground claims against.
- **Two-tier finding split.** Confirmed vulnerabilities go in the polished body. Unconfirmed observations go to "Items Requiring Validation." Unsupported individual claims go to "Claims Pending Independent Verification." Nothing shaky lands in the client-facing report.
- **Professional exports.** PDF (`@react-pdf/renderer`) and DOCX (`docx`) match the typography of real consulting deliverables — cover page, executive summary, scope & methodology, severity distribution, findings summary, detailed findings, evidence appendix with embedded screenshots, disclaimer.
- **Deterministic mock fallback.** If the OpenAI key is missing or the call fails, Verric loads a hand-grounded demo report so the demo never breaks.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript 5.7** · **Tailwind 3**
- **OpenAI Chat Completions** (`gpt-4o-mini` by default) for both drafting and grounding verification
- **`@react-pdf/renderer`** for PDF export · **`docx`** for Word export
- Pure-TS CVSS 3.1 scorer and Nmap plain-text parser — no external dependencies

## Architecture

```
RAW EVIDENCE                 VERRIC ENGINE                       OUTPUT

  nmap-scan.txt        ┌──> 1. Parse & chunk (parseNmap, …)
  burp-poc.http        │    2. LLM drafts findings + summary    ✓ Grounded claims (in body)
  sqlmap-log.txt    ───┤    3. Map every claim → evidence       ⚠ Flagged claims (held)
  notes.md             │    4. Independent grounding pass       ✓ CVSS computed from vector
  screenshot.png       └──> 5. Computed CVSS 3.1 base score    → Client-ready PDF / DOCX / TXT
```

The defensible work is steps 3–5: provenance, independent grounding, and computed scoring.

## Project layout

```
src/
├── app/
│   ├── page.tsx                     # 5-step studio: setup → evidence → review → draft → export
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── generate-report/route.ts # LLM draft + verifyGrounding() second pass
│       ├── export-pdf/route.tsx     # multi-page React-PDF renderer
│       ├── export-docx/route.ts     # docx renderer
│       └── export-txt/route.ts
└── lib/
    └── report.ts                    # types, validateReport, cvssFromVector,
                                     # parseNmap, buildEvidenceChunks, mock report
demo-complete-evidence-pack/         # 10 pre-canned artifacts for the demo flow
```

## Getting started

```bash
git clone https://github.com/Dawn-Fighter/verric.git
cd verric
npm install
cp .env.local.example .env.local
# add your OpenAI key to .env.local
npm run dev
```

Then open <http://localhost:3000> and drag the files from `demo-complete-evidence-pack/` into the drop zone.

### Environment

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for live mode. Without it Verric runs in deterministic mock mode. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Used for both drafting and the grounding-verification pass. |
| `USE_MOCK_REPORT` | `false` | Set to `true` to force the deterministic demo report. |

## How grounding actually works

Most AI report tools self-cite — the model says "supported by ev-020" and that's the end of it. Verric runs a **second independent LLM call** after drafting:

1. The drafter produces findings with `evidenceIds` per claim.
2. `validateReport` strips any IDs that don't exist and computes CVSS from the vector.
3. `verifyGrounding` sends `{ claimText, citedEvidenceText[] }` for every factual claim to a separate `gpt-4o-mini` call (temp 0) and asks: does the evidence actually support this exact sentence? Verdicts → `supported | partial | unsupported`.
4. Verdicts are mapped onto claim status with a one-line reason in `groundingNote`.
5. In the studio: inline `⚠` badge. In the export: pulled out of the polished body into a "Claims Pending Independent Verification" section.

Verification is scoped to factual / observational claims (executive summary, finding description / impact / proof of concept). Prescriptive guidance (remediations, key recommendations) isn't ground-checked because "implement parameterized queries" is good advice whether or not the source artifact contains those exact words.

## Roadmap

| When | What |
|---|---|
| Now | Pentest report engine — raw evidence → grounded, client-ready report |
| Next | More structured parsers (Burp XML, Nessus `.nessus`, Nuclei JSONL); SOC incident write-ups using the same grounding engine |
| Later | Security-annotated code docs — point the engine at a repo for living docs with traceable security flags |

## Why us

We've written these reports by hand. We know what a credible finding looks like — and exactly where an AI must be kept honest. This isn't a guess at a problem. We've lived it.

— Team Stratosix

## License

MIT
