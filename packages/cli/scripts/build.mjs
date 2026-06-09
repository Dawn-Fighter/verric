// Bundle the CLI into a single executable .mjs file.
//
// We use esbuild rather than tsc + manual extension fixup because:
//   1. The output is one file, no module-resolution drama at runtime.
//   2. Workspace deps (@verric/core) get inlined, so no symlink chasing.
//   3. node:* and node_modules deps stay external, so we don't ship a
//      bloated 5MB blob.
//
// The shebang is prepended via the `banner` option so the output is
// directly executable.

import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(root, "src/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: resolve(root, "dist/cli.mjs"),
  // Inline workspace deps so the CLI is self-contained. Only Node
  // builtins stay external (esbuild handles `node:*` automatically on
  // platform=node, but we list them explicitly for clarity).
  external: [],
  banner: {
    js: "#!/usr/bin/env node\n"
  },
  legalComments: "none",
  sourcemap: false,
  logLevel: "info"
});

chmodSync(resolve(root, "dist/cli.mjs"), 0o755);
console.log("✓ built dist/cli.mjs");
