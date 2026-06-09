// `verric report` — run the engine against a directory of evidence and
// write the resulting report + receipt to disk.
//
// Example:
//   verric report --evidence ./engagement/evidence \
//                 --project ./engagement/project.json \
//                 --out ./engagement/out \
//                 --provider ollama

import { resolve } from "node:path";
import { buildEvidenceChunks, runReport, VerricEngineError, LLMProviderError } from "@verric/core";
import { parseArgs, flagOrEnv } from "../args";
import { readEvidenceDir, readProjectFile, writeJsonFile } from "../io";
import { buildProvider } from "../provider";

const HELP = `verric report — generate a grounded report from a directory of evidence

Usage:
  verric report --evidence <dir> [options]

Options:
  --evidence <dir>      Directory of evidence files (required)
  --project <file>      ProjectDetails JSON file (defaults to built-in sample)
  --notes <file>        Free-text tester notes appended as manual-notes.md
  --out <dir>           Output directory (default: ./verric-out)
  --provider <id>       openai | anthropic | ollama (env: VERRIC_PROVIDER)
  --model <id>          Override model id (env: <PROVIDER>_MODEL)
  --base-url <url>      Override provider base URL
  --signing-key <key>   HMAC key for receipts (env: VERRIC_SIGNING_KEY)
  --no-canary           Disable the adversarial canary check (NOT recommended)
  --no-verifier         Skip the independent grounding pass
  --quiet               Suppress progress output
  --help                Show this message
`;

interface ReportArgs {
  evidence?: string;
  project?: string;
  notes?: string;
  out?: string;
  provider?: string;
  model?: string;
  "base-url"?: string;
  "signing-key"?: string;
  "no-canary"?: boolean;
  "no-verifier"?: boolean;
  quiet?: boolean;
  help?: boolean;
}

export async function runReportCommand(argv: string[]): Promise<number> {
  const { flags } = parseArgs(["report", ...argv], {
    evidence: { type: "string" },
    project: { type: "string" },
    notes: { type: "string" },
    out: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    "base-url": { type: "string" },
    "signing-key": { type: "string" },
    "no-canary": { type: "boolean" },
    "no-verifier": { type: "boolean" },
    quiet: { type: "boolean" },
    help: { type: "boolean" }
  });

  const args = flags as ReportArgs;

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!args.evidence) {
    process.stderr.write("error: --evidence <dir> is required\n");
    process.stderr.write(HELP);
    return 2;
  }

  const out = resolve(args.out ?? "./verric-out");
  const log = (msg: string) => {
    if (!args.quiet) process.stderr.write(`${msg}\n`);
  };

  log(`> reading evidence from ${args.evidence}`);
  const artifacts = await readEvidenceDir(args.evidence);
  if (artifacts.length === 0) {
    process.stderr.write(`error: no readable evidence files in ${args.evidence}\n`);
    return 2;
  }
  log(`  found ${artifacts.length} artifacts`);

  const project = await readProjectFile(args.project);
  log(`> project: ${project.clientName} / ${project.projectName}`);

  // Optional manual notes
  let notes = "";
  if (args.notes) {
    const { readFile } = await import("node:fs/promises");
    notes = await readFile(args.notes, "utf8");
  }
  const chunks = buildEvidenceChunks(artifacts, notes).slice(0, 180);
  log(`  chunked into ${chunks.length} evidence pieces`);

  let provider;
  try {
    provider = buildProvider({
      provider: args.provider,
      model: args.model,
      baseUrl: args["base-url"]
    });
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 3;
  }
  log(`> provider: ${provider.id} (${provider.model})`);

  const signingKey = flagOrEnv(flags, "signing-key", "VERRIC_SIGNING_KEY") ?? "verric-unsigned";

  log(`> running engine`);
  try {
    const result = await runReport({
      project,
      artifacts,
      chunks,
      provider,
      template: "pentest@0.1.0",
      signingKey,
      enableCanary: !args["no-canary"],
      enableVerifier: !args["no-verifier"]
    });

    await writeJsonFile(`${out}/report.json`, result.report);
    await writeJsonFile(`${out}/receipt.json`, result.receipt);
    await writeJsonFile(`${out}/verdicts.json`, result.verdicts);
    await writeJsonFile(`${out}/evidence.json`, chunks);
    await writeJsonFile(`${out}/metadata.json`, result.metadata);

    log(`> wrote report → ${out}/report.json`);
    log(`> wrote receipt → ${out}/receipt.json (sig ${result.receipt.signature.slice(0, 12)}…)`);
    log(`> took ${result.metadata.durationMs}ms`);
    if (result.metadata.verifierFailed) {
      log(`! verifier failed (non-fatal); claims may be over-trusted — re-run recommended`);
    }
    return 0;
  } catch (err) {
    if (err instanceof VerricEngineError) {
      process.stderr.write(`engine failure (${err.stage}): ${err.message}\n`);
      return err.stage === "canary_triggered" ? 4 : 5;
    }
    if (err instanceof LLMProviderError) {
      process.stderr.write(`provider error (${err.providerId}): ${err.message}\n`);
      return 6;
    }
    process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
    return 1;
  }
}
