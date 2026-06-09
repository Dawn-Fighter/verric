// Bundle the MCP server to a single self-contained .mjs.
//
// node:* and the MCP SDK stay external (the SDK ships ESM and is too
// heavy to inline); workspace deps get inlined.

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
  outfile: resolve(root, "dist/server.mjs"),
  external: [],
  banner: { js: "#!/usr/bin/env node\n" },
  legalComments: "none",
  sourcemap: false,
  logLevel: "info"
});

chmodSync(resolve(root, "dist/server.mjs"), 0o755);
console.log("✓ built dist/server.mjs");
