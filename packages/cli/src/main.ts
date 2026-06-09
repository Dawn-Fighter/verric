// CLI entry point — invokes runCli and exits with its return code.
// Kept separate from index.ts so importing the CLI as a library
// doesn't have side effects.

import { runCli } from "./index";

const argv = process.argv.slice(2);
runCli(argv).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`fatal: ${detail}\n`);
    process.exit(1);
  }
);
