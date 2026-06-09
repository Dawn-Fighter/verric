# Verric GitHub Action

Generate an evidence-grounded report — pentest, postmortem, audit — straight from your CI pipeline. The action wraps the [`verric` CLI](../../../packages/cli/) and uploads the resulting `report.json`, `receipt.json`, and verdicts as a workflow artifact.

## Trust contract

- Real provider or honest failure. **No mock fallback.**
- Every successful run produces a [cryptographic receipt](../../../packages/core/src/receipts.ts) signed with `VERRIC_SIGNING_KEY` (defaults to `${{ github.sha }}` so receipts are reproducible per commit).
- The grounding pass + adversarial canary still run; if a model gets prompt-injected, the action exits non-zero.

## Quick start

```yaml
name: Generate pentest report
on:
  workflow_dispatch:
  push:
    paths: ["evidence/**"]

jobs:
  verric:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/verric
        with:
          evidence-dir: ./evidence
          project-file: ./engagement.json
          provider: openai
```

## Inputs

| Name | Description | Required | Default |
|---|---|---|---|
| `evidence-dir` | Directory of evidence files | yes | — |
| `project-file` | `ProjectDetails` JSON | no | built-in sample |
| `notes-file`   | Markdown notes appended to evidence | no | — |
| `out-dir`      | Where to write report/receipt/verdicts | no | `./verric-out` |
| `provider`     | `openai` \| `anthropic` \| `ollama` | no | auto-detect |
| `model`        | Override model id | no | provider default |
| `signing-key`  | HMAC key for the receipt | no | `${{ github.sha }}` |
| `template`     | Report template id | no | `pentest@0.1.0` |

## Outputs

| Name | Description |
|---|---|
| `report-path` | Path to the generated `report.json` |
| `receipt-path` | Path to the signed `receipt.json` |
| `receipt-signature` | First 16 hex chars of the HMAC signature |

## Verifying a receipt later

Anyone with the same signing key can independently verify a receipt:

```bash
verric verify \
  --receipt  ./verric-out/receipt.json \
  --report   ./verric-out/report.json \
  --evidence ./verric-out/evidence.json \
  --signing-key $GITHUB_SHA
```

Exit 0 = signature valid. Non-zero with a per-field breakdown on stderr otherwise.
