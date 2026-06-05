<div align="center">

# 🧾 Verric

### *pentest reports you can prove.*

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-gpt--4o--mini-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](./LICENSE)
[![HackArena](https://img.shields.io/badge/HackArena-2.0-c8344f?style=for-the-badge)](https://unstop.com/hackathons/hackarena-20-hyderabad-zonals-hackarena-20-ignite-room-1654428)

<br/>

**Drop the raw mess of a finished engagement. Get a client-ready report where every claim is traceable to its evidence — and anything the AI can't prove is flagged, never shipped.**

*Submitted to **HackArena 2.0 — Hyderabad Zonals** by Team Stratosix.*

</div>

-----

## 🧠 The Problem

Reporting eats up to **60%** of a pentest engagement. Teams won't let AI fix it because **one hallucinated finding ships a liability to a paying client.**

> The bottleneck isn't speed. It's **trust.**

Most AI report tools generate text. Verric makes the AI **prove every line.**

-----

## ✨ What Makes Verric Different

|                            | Other AI report tools                 | **Verric**                                              |
|----------------------------|---------------------------------------|---------------------------------------------------------|
| AI drafts findings         | ✅                                     | ✅                                                       |
| Every claim cites evidence | ❌                                     | ✅ hover-to-source provenance                            |
| Independent grounding pass | ❌                                     | ✅ second LLM rechecks every claim                       |
| CVSS scoring               | model guesses (and drifts from vector) | ✅ **computed in code** from CVSS 3.1 base formula       |
| Unproven claims            | silently shipped                      | ✅ pulled out into "Items Requiring Validation"          |
| Structured tool parsing    | raw text only                         | ✅ Nmap parser → live Hosts & Services table             |
| Polished export            | basic                                 | ✅ multi-page PDF + DOCX matching real consulting docs   |

-----

## 🚀 The Pipeline

```
RAW EVIDENCE                 VERRIC ENGINE                       OUTPUT

  nmap-scan.txt        ┌──> 1. Parse & chunk (parseNmap, …)
  burp-poc.http        │    2. LLM drafts findings + summary    ✓ Grounded claims (in body)
  sqlmap-log.txt    ───┤    3. Map every claim → evidence       ⚠ Flagged claims (held)
  notes.md             │    4. Independent grounding pass       ✓ CVSS computed from vector
  screenshot.png       └──> 5. Computed CVSS 3.1 base score    → Client-ready PDF / DOCX / TXT
```

The defensible work is steps **3-5**: provenance, independent grounding, and computed scoring. That's the moat.

-----

## 🔥 Live Features

- 🔗 **Hover-to-source provenance** — every claim carries `evidenceIds`. Hover a sentence, the source chunk lights up.
- 🛡️ **Independent grounding verification** — a second LLM pass labels each claim *supported / partial / unsupported*. Reasons surface as inline `⚠` badges.
- 🎯 **Computed CVSS 3.1** — score calculated in code from the vector. Score, vector, and severity can never disagree.
- 🔍 **Real Nmap parser** — plain-text `-sV` output → structured Hosts & Services table in the Evidence Intake card.
- 🪤 **Two-tier finding split** — confirmed vulns in the polished body. Unconfirmed observations go to *Items Requiring Validation*. Unsupported claims go to *Claims Pending Independent Verification*. Nothing shaky lands in the client report.
- 📄 **Professional exports** — PDF (`@react-pdf/renderer`) + DOCX (`docx`) + TXT, with cover, executive summary, severity distribution, findings summary, detailed findings, evidence appendix with embedded screenshots, disclaimer.
- 🧪 **Deterministic mock fallback** — no OpenAI key? Verric loads a hand-grounded demo report. The demo never breaks.
- 🎬 **Live status messages** — Run Verric Review shows a rotating status (*"Second-guessing the AI…"*, *"Computing CVSS 3.1 base scores…"*) so the ~30s pipeline doesn't feel frozen.

-----

## 🛠️ Tech Stack

| Layer            | Technology                                |
|------------------|-------------------------------------------|
| Framework        | Next.js 16 (App Router)                   |
| UI               | React 19 · TypeScript 5.7 · Tailwind 3    |
| AI               | OpenAI Chat Completions (`gpt-4o-mini`)   |
| Drafting + Grounding | Two-pass: model writes → model verifies |
| PDF export       | `@react-pdf/renderer`                     |
| DOCX export      | `docx`                                    |
| CVSS scorer      | Pure-TS, no deps                          |
| Nmap parser      | Pure-TS, no deps                          |

-----

## 🏃 Getting Started

### Prerequisites

- **Node.js** 18+
- An **[OpenAI API key](https://platform.openai.com)** (or skip it for mock mode)

### 1. Clone and install

```bash
git clone https://github.com/Dawn-Fighter/verric.git
cd verric
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
USE_MOCK_REPORT=false
```

> No key? Set `USE_MOCK_REPORT=true` and Verric runs the deterministic demo report.

### 3. Run

```bash
npm run dev
```

Open <http://localhost:3000>.

### 4. Run the demo

Two demo packs ship with the repo:

| Pack                                  | What it proves                                      |
|---------------------------------------|-----------------------------------------------------|
| `demo-complete-evidence-pack/`        | Full evidence — all 3 findings ship as confirmed.   |
| `demo-evidence-pack/`                 | **Partial evidence** — Verric catches the unconfirmed SQL injection candidate and routes it to *Items Requiring Validation*. |

Drag the files from one of those folders into the drop zone, hit **Run Verric Review**, and watch the trust layer work.

-----

## 📁 Project Layout

```
verric/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # 5-step studio (setup → evidence → review → draft → export)
│   │   ├── layout.tsx
│   │   └── api/
│   │       ├── generate-report/         # LLM draft + verifyGrounding() second pass
│   │       ├── export-pdf/              # multi-page React-PDF renderer
│   │       ├── export-docx/             # docx renderer
│   │       └── export-txt/              # plain-text renderer
│   └── lib/
│       └── report.ts                    # types · validateReport · cvssFromVector
│                                          parseNmap · buildEvidenceChunks · mock
├── demo-complete-evidence-pack/         # 10 artefacts — all findings confirmed
├── demo-evidence-pack/                  # 8 artefacts — SQL injection candidate
└── .env.local.example
```

-----

## 🔬 How Grounding Actually Works

Most AI report tools self-cite — the model says "supported by ev-020" and that's the end of it. **Verric runs a second independent LLM call after drafting.**

1. The drafter produces findings with `evidenceIds` per claim.
2. `validateReport` strips any IDs that don't exist and **computes CVSS from the vector**.
3. `verifyGrounding` sends `{ claimText, citedEvidenceText[] }` for every factual claim to a separate `gpt-4o-mini` call (temp 0): *"Does the evidence actually support this exact sentence?"* Verdicts → `supported | partial | unsupported`.
4. Verdicts are mapped onto claim status with a one-line `groundingNote` reason.
5. **Studio:** inline `⚠` badge with the reason. **Export:** unsupported claims get pulled into *Claims Pending Independent Verification*.

Verification scopes only **factual / observational** claims (executive summary, finding description / impact / proof of concept). Prescriptive guidance (remediations, recommendations) isn't ground-checked because *"implement parameterized queries"* is good advice whether or not the source artefact contains those exact words.

-----

## 🗺️ Roadmap

| When  | What                                                                                       |
|-------|--------------------------------------------------------------------------------------------|
| Now   | Pentest report engine — raw evidence → grounded, client-ready report                        |
| Next  | More structured parsers (Burp XML, Nessus, Nuclei JSONL); SOC incident write-ups            |
| Later | Security-annotated code docs — point the engine at a repo for living docs with traceable security flags |

-----

## 👥 Why Us

We've written these reports by hand. We know what a credible finding looks like — and exactly where an AI must be kept honest. **This isn't a guess at a problem. We've lived it.**

— **Team Stratosix**

-----

## 🤝 Contributing

PRs welcome. For substantial changes, open an issue first.

```bash
git checkout -b feat/your-feature
git commit -m "feat: add your feature"
git push origin feat/your-feature
```

-----

## 📄 License

[MIT](./LICENSE) © [Team Stratosix](https://github.com/Dawn-Fighter)

-----

<div align="center">

*Every AI tool asks you to trust it. **Verric lets you prove it.***

</div>
