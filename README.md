<div align="center">

# 🧾 Verric

### *evidence you can prove. reports you can ship.*

[![CI](https://img.shields.io/badge/CI-format·lint·typecheck·test·build-2f6f4e?style=for-the-badge)](.github/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-215_passing-2f6f4e?style=for-the-badge)](#-quality-gate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](./LICENSE)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io)
[![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)](https://turbo.build)
[![Providers](https://img.shields.io/badge/LLM-OpenAI·Anthropic·Ollama-412991?style=for-the-badge&logo=openai&logoColor=white)](#-providers--byo-key-local-first)

<br/>

**Verric is an open-source, self-hostable engine that turns the raw mess of an engagement into a report where _every claim is traceable to its evidence_ — and anything the model can't prove is flagged, never shipped.**

Pentest is the flagship. Postmortems and ADRs prove it generalizes. The engine is the product.

</div>

---

## 🧠 The problem

A penetration-test report eats **6–12 hours** of senior time. Incident postmortems eat 60–90 minutes just reconstructing the timeline. Teams won't let AI close that gap, because **one hallucinated finding ships a liability to a paying client.**

> The bottleneck was never speed. It's **trust.**

Most "AI report" tools _generate text_. Verric makes the model **prove every line** — then verifies the proof independently, scores it, and signs the result.

---

## ✨ What makes Verric different

|                                  | Typical AI report tools          | **Verric**                                                        |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| Claim → evidence provenance      | ❌                                | ✅ every sentence cites exact evidence chunk IDs                   |
| Independent grounding pass       | ❌                                | ✅ a second model rechecks whether the evidence supports the claim |
| Confidence score                 | model's own logprobs (or none)   | ✅ **NLI entailment** computed from the cited text, not the model  |
| CVSS scoring                     | model guesses, drifts from vector | ✅ **computed in code** from the CVSS 3.1 base formula             |
| Unproven claims                  | silently shipped                  | ✅ pulled into "Items Requiring Validation," never the body        |
| Prompt-injection from evidence   | unguarded                         | ✅ delimited untrusted input + an adversarial canary that fails closed |
| Tamper-evidence                  | none                              | ✅ a signed **cryptographic receipt** per run                      |
| When the model is unavailable    | fabricates a demo                 | ✅ **real provider or honest failure** — no mock fallback          |
| Surfaces                         | one web app                       | ✅ web · CLI · REST/SDK · GitHub Action · GitHub App · MCP · desktop |

---

## 🔬 How grounding actually works

Other tools let the model self-cite — it says _"supported by ev-020"_ and that's the end of it. Verric treats the citation as the unit of trust and runs a **deterministic pipeline around the model**:

```
                         ┌──────────────────────── @verric/core engine ────────────────────────┐
 RAW EVIDENCE            │                                                                       │     OUTPUT
                         │  1. import + chunk     scanners → structured, ID'd evidence chunks     │
  nmap / burp / nessus   │  2. draft              provider writes findings citing chunk IDs       │  ✓ grounded claims (body)
  nuclei / zap / openvas ─┼─ 3. schema-validate    zod parse + one repair retry, or honest fail    ─┼─ ⚠ flagged / partial (held)
  slack / pagerduty / gh │  4. validate (in code) recompute CVSS, scrub bogus IDs, fill defaults   │  ✓ CVSS computed from vector
  logs / notes / images  │  5. canary check       fail closed if an injection sentinel echoes      │  🔢 NLI confidence per claim
                         │  6. ground (2nd pass)  independent verifier: supported/partial/unsup.   │  🧾 signed receipt
                         │  7. NLI + receipt      entailment-blended confidence, HMAC-SHA-256       │  → PDF · DOCX · TXT · JSON
                         └───────────────────────────────────────────────────────────────────────┘
```

Steps **4–7 are the moat**: deterministic validation, an adversarial-hardened second opinion, an independent entailment measurement, and a portable proof.

- **Provenance** — every `ReportClaim` carries `evidenceIds`. Hover a sentence in the studio and its source chunk lights up.
- **Independent grounding** — a separate, hardened verifier call answers _"does this evidence actually support this exact sentence?"_ → `supported · partial · unsupported`, with a one-line reason. Only factual claims are checked; prescriptive advice ("use parameterized queries") is exempt.
- **NLI confidence** — an entailment scorer reads the cited evidence (premise) against the claim (hypothesis) and produces a confidence that's blended with the verdict. A claim the verifier rubber-stamps "supported" but whose words aren't in the evidence gets **pulled down** — the whole point of a second, independent signal.
- **Computed CVSS 3.1** — the base score is calculated in code from the vector, so score, vector, and severity can never disagree.
- **Adversarial canary** — a sentinel chunk is injected into every drafter/verifier prompt; if the model's output echoes it, the run **fails closed** rather than shipping a manipulated report.
- **Cryptographic receipt** — every successful run is signed (HMAC-SHA-256) over `{evidence digest, prompts, model, output, verdicts, timestamp}`. Anyone with the key can independently re-verify the report later with `verric verify`.

---

## 🧩 One engine, three templates

A "domain" in Verric is three small plugins: an **Importer**, a **ReportTemplate**, and (optionally) a domain validator. The same pipeline — grounding, CVSS, canary, NLI, receipts — applies to all of them.

| Template            | ID                 | Turns…                                              | into…                                            |
| ------------------- | ------------------ | --------------------------------------------------- | ------------------------------------------------ |
| **Pentest** (flagship) | `pentest@0.1.0`    | nmap / Burp / Nessus / Nuclei / ZAP / OpenVAS output | a client-ready penetration-test report           |
| **Postmortem**      | `postmortem@0.1.0` | Slack threads · PagerDuty · logs · commits          | a blameless incident postmortem                  |
| **ADR**             | `adr@0.1.0`        | a merged pull request (description, commits, diff)  | an Architecture Decision Record                  |

**Importers (9):** `nmap` · `burp` · `nessus` · `nuclei` · `zap` · `openvas` · `slack` · `pagerduty` · `github`. Adding one is a non-breaking plugin.

---

## 🛰️ Surfaces — meet every dev where they are

| Surface            | Package / path                   | What it's for                                                              |
| ------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| **Web studio**     | `apps/web`                       | Authoring, review, the claim editor, version history + diff, exports       |
| **CLI**            | `@verric/cli`                    | `verric report` / `verric verify` — scriptable, CI-friendly, single binary |
| **REST + SDK**     | `@verric/sdk`                    | Typed client (Node + browser) over the HTTP API, with SSE progress         |
| **GitHub Action**  | `.github/actions/verric`         | Generate a grounded report from CI artifacts; upload it + the receipt      |
| **GitHub App**     | `apps/web` `…/api/github/webhook`| Auto-draft a postmortem on `verric:postmortem` issues / an ADR on `verric:adr` PR merges |
| **MCP server**     | `@verric/mcp-server`             | Expose runs/reports/receipts as tools to Cursor / Claude Code / opencode   |
| **Desktop**        | `apps/desktop`                   | Tauri 2 native shell (`.deb` / `.AppImage` / `.dmg` / `.msi`)              |

---

## 🚀 Quickstart

### Run the studio (Docker)

```bash
git clone https://github.com/Dawn-Fighter/verric.git
cd verric
cp apps/web/.env.local.example apps/web/.env.local   # add a provider key (or use Ollama)
docker compose up
# → http://localhost:3000
```

### Run from source

> **Prerequisites:** Node **22+** (the storage layer uses the built-in `node:sqlite`) and **pnpm 11+**.

```bash
pnpm install
pnpm --filter @verric/web dev
# → http://localhost:3000
```

### Workspace commands

```bash
pnpm build         # build every package + the web app (turbo)
pnpm test          # 215 vitest tests
pnpm typecheck     # tsc across all packages
pnpm lint          # eslint
pnpm format        # prettier --write
```

---

## 🔑 Providers — BYO-key, local-first

Verric is provider-agnostic and brings your own key. **There is no mock fallback** — if the configured provider can't be reached, the run fails honestly with a clear error.

```env
# apps/web/.env.local
VERRIC_PROVIDER=openai            # openai | anthropic | ollama

OPENAI_API_KEY=sk-...             # OpenAI
ANTHROPIC_API_KEY=...             # Anthropic
OLLAMA_BASE_URL=http://127.0.0.1:11434   # fully local / air-gapped

VERRIC_SIGNING_KEY=change-me      # HMAC key for verifiable receipts
VERRIC_DB_PATH=verric.db          # SQLite location (default)
```

Point it at a local **Ollama** model and nothing leaves the machine — the right default for sensitive evidence.

---

## 🖥️ CLI

```bash
# Generate a grounded report from a folder of evidence
verric report \
  --evidence ./engagement/evidence \
  --project  ./engagement/project.json \
  --provider ollama \
  --out      ./engagement/out
#   → out/report.json · receipt.json · verdicts.json · evidence.json · metadata.json

# Independently verify a report's receipt later (exit 0 = valid)
verric verify \
  --receipt  ./engagement/out/receipt.json \
  --report   ./engagement/out/report.json \
  --evidence ./engagement/out/evidence.json \
  --signing-key "$VERRIC_SIGNING_KEY"
```

---

## 🔌 MCP server

Expose your team's grounded reports to a coding agent as a trusted, queryable source.

```jsonc
// e.g. Claude Code / opencode mcp config
{
  "mcpServers": {
    "verric": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.mjs"],
      "env": { "VERRIC_DB_PATH": "/data/verric/verric.db" }
    }
  }
}
```

Tools: `verric_list_runs` · `verric_get_run` · `verric_list_run_events` · `verric_verify_receipt`.

---

## 🏗️ Architecture

A pnpm + Turborepo monorepo. The engine is a pure-TypeScript package with no React/Next dependency, so the web app, CLI, API, Action, and desktop shell all share one brain.

```
verric/
├── packages/
│   ├── core/          @verric/core   — engine: providers · prompts (+ injection defense) ·
│   │                                    zod schema · validate · CVSS · NLI · receipts ·
│   │                                    importers/* · templates (pentest · postmortem · adr)
│   ├── storage/       @verric/storage — node:sqlite (schema v4): projects · runs · chunks ·
│   │                                    artifacts · reports · run_events · report_versions ·
│   │                                    claim_edits · finding_library · branding · templates
│   ├── cli/           @verric/cli     — `verric report` / `verric verify` (esbuild bundle)
│   ├── sdk/           @verric/sdk     — typed REST + SSE client (Node + browser)
│   └── mcp-server/    @verric/mcp-server — MCP stdio server
├── apps/
│   ├── web/           Next 16 studio + REST API (17 routes)
│   └── desktop/       Tauri 2 native shell
├── .github/
│   ├── workflows/ci.yml          format · lint · typecheck · test · build
│   ├── actions/verric/           composite GitHub Action
│   └── apps/verric/              GitHub App docs
└── docker-compose.yml · Dockerfile
```

**Web API (17 routes):** `health` · `generate-report` (202 + async) · `runs` (list) · `runs/[id]` (get/delete) · `runs/[id]/stream` (SSE) · `runs/[id]/versions` · `runs/[id]/diff` · `runs/[id]/claims/[claimId]` (edit · accept · reject · re-ground) · `library/findings[/id]` · `branding[/id]` · `templates` · `github/webhook` · `export-{pdf,docx,txt}`.

---

## 🎛️ The studio

A five-step workspace — **setup → evidence → review → draft → export** — plus three management surfaces:

- **Async pipeline + live SSE progress** — runs are queued and streamed; you watch real engine stages (`drafting → parsed → verified → finalized`), not a fake spinner.
- **Claim editor** — accept, reject, or **re-ground** any claim; edits are versioned and re-scored.
- **Version history + claim-level diff** (`/runs`) — every report version, with a before/after diff of text, evidence, and status transitions.
- **Finding library** (`/library`) — reusable, pre-vetted writeups.
- **Branding** (`/branding`) — logo, colors, footer, cover subtitle; flows straight into PDF/DOCX export.
- **Professional exports** — multi-page PDF (`@react-pdf/renderer`), DOCX (`docx`), and TXT, with cover, executive summary, severity distribution, findings, evidence appendix, and an "Items Requiring Validation" section for anything unproven.

---

## ✅ Quality gate

Every change must pass all five, locally and in CI:

```
✓ prettier --check      ✓ eslint        ✓ tsc (all packages)
✓ 215 vitest tests      ✓ turbo build (web + cli + mcp-server)
```

Tests cover the load-bearing logic directly: CVSS math, every importer, the zod schema + repair path, provider adapters, receipt sign/verify + tamper detection, the engine orchestration (including canary-fail-closed and NLI-blended confidence), and the full storage layer.

---

## 🛠️ Tech stack

| Layer        | Choice                                                       |
| ------------ | ------------------------------------------------------------ |
| Monorepo     | pnpm workspaces · Turborepo                                  |
| Language     | TypeScript 5.7                                               |
| Web          | Next.js 16 (App Router) · React 19 · Tailwind 3              |
| Engine       | Pure TS · Zod · `node:crypto` (receipts)                     |
| Persistence  | `node:sqlite` (built-in, zero native deps) — Postgres optional later |
| LLM          | OpenAI · Anthropic · Ollama (BYO-key)                        |
| Exports      | `@react-pdf/renderer` · `docx`                               |
| Desktop      | Tauri 2 (Rust)                                               |
| Tooling      | Vitest · ESLint · Prettier · esbuild · GitHub Actions · Docker |

---

## 🗺️ Roadmap

| Status | Item                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| ✅ Done | Evidence-grounded engine · pentest + postmortem + ADR templates · 9 importers · async pipeline + SSE · claim editor + version diff · finding library · branding · CLI · SDK · GitHub Action + App · MCP server · cryptographic receipts · NLI confidence · Tauri desktop bundle |
| 🔜 Next | Transformer-backed NLI model (the `NliScorer` interface is ready for a drop-in) · more importers (Datadog, Sentry, Qualys) |
| 🔭 Later | Postgres adapter + multi-tenant auth/RBAC · a hosted template marketplace (the registry primitive already ships) |

---

## 🤝 Contributing

PRs welcome. For substantial changes, open an issue first.

```bash
git checkout -b feat/your-feature
pnpm install
# make changes, then make the gate green:
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
git commit -m "feat: your feature"
git push -u origin feat/your-feature
```

---

## 📄 License

[MIT](./LICENSE) © [Team Stratosix](https://github.com/Dawn-Fighter) · born at **HackArena 2.0 — Hyderabad Zonals**.

<div align="center">
<br/>

**Every AI tool asks you to trust it. Verric lets you _prove_ it.**

</div>
