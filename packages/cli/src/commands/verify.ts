// `verric verify` — independently verify a Verric receipt.
//
// Recomputes evidence + report digests and the HMAC signature, prints
// a per-field comparison. Anyone with the signing key can verify a
// report was produced from exactly the supplied evidence.

import { verifyReceipt, type Receipt, type VerricReport, type EvidenceChunk } from "@verric/core";
import { parseArgs, flagOrEnv } from "../args";
import { readJsonFile } from "../io";

const HELP = `verric verify — independently verify a Verric receipt

Usage:
  verric verify --receipt <file> --report <file> --evidence <file> [options]

Options:
  --receipt <file>      Signed receipt JSON (required)
  --report <file>       Report JSON (required)
  --evidence <file>     Evidence chunks JSON (required)
  --verdicts <file>     Optional grounding verdicts JSON
  --signing-key <key>   HMAC key the receipt was signed with (env: VERRIC_SIGNING_KEY)
  --help                Show this message

Exit code 0 = receipt verified. Non-zero = mismatch detected.
`;

interface VerifyArgs {
  receipt?: string;
  report?: string;
  evidence?: string;
  verdicts?: string;
  "signing-key"?: string;
  help?: boolean;
}

export async function runVerifyCommand(argv: string[]): Promise<number> {
  const { flags } = parseArgs(["verify", ...argv], {
    receipt: { type: "string" },
    report: { type: "string" },
    evidence: { type: "string" },
    verdicts: { type: "string" },
    "signing-key": { type: "string" },
    help: { type: "boolean" }
  });
  const args = flags as VerifyArgs;

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.receipt || !args.report || !args.evidence) {
    process.stderr.write("error: --receipt, --report, and --evidence are all required\n");
    process.stderr.write(HELP);
    return 2;
  }

  const signingKey = flagOrEnv(flags, "signing-key", "VERRIC_SIGNING_KEY");
  if (!signingKey) {
    process.stderr.write("error: --signing-key (or VERRIC_SIGNING_KEY) is required\n");
    return 2;
  }

  const receipt = await readJsonFile<Receipt>(args.receipt);
  const report = await readJsonFile<VerricReport>(args.report);
  const evidence = await readJsonFile<EvidenceChunk[]>(args.evidence);
  const verdicts = args.verdicts ? await readJsonFile<NonNullable<unknown>>(args.verdicts) : undefined;

  const result = verifyReceipt({
    receipt,
    signingKey,
    evidence,
    report,
    verdicts: Array.isArray(verdicts)
      ? (verdicts as Parameters<typeof verifyReceipt>[0]["verdicts"])
      : undefined
  });

  if (result.ok) {
    process.stdout.write(`receipt OK — signature ${receipt.signature.slice(0, 16)}…\n`);
    process.stdout.write(`  run ${receipt.runId}\n`);
    process.stdout.write(`  template ${receipt.template}\n`);
    process.stdout.write(`  provider ${receipt.providerId} / ${receipt.model}\n`);
    process.stdout.write(`  evidence digest ${receipt.digests.evidence}\n`);
    process.stdout.write(`  report digest ${receipt.digests.report}\n`);
    return 0;
  }
  process.stderr.write(`receipt FAILED — mismatches: ${result.mismatches.join(", ")}\n`);
  return 1;
}
