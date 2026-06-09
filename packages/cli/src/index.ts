// Top-level CLI entry. Exposed as both a function (for testing) and a
// shebang in bin/verric.mjs.

import { runReportCommand } from "./commands/report";
import { runVerifyCommand } from "./commands/verify";

const TOP_HELP = `verric — evidence-grounded document engine

Usage:
  verric <command> [options]

Commands:
  report    Generate a grounded report from evidence
  verify    Independently verify a Verric receipt
  help      Show this message

Run 'verric <command> --help' for command-specific options.
Docs: https://github.com/edneam/verric
`;

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(TOP_HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write("verric 0.1.0\n");
    return 0;
  }
  switch (command) {
    case "report":
      return runReportCommand(rest);
    case "verify":
      return runVerifyCommand(rest);
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      process.stderr.write(TOP_HELP);
      return 2;
  }
}
