import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime image only needs the traced files, not the full node_modules.
  output: "standalone",
  // We're inside a pnpm monorepo. Tell Next to trace dependencies starting
  // from the workspace root so symlinked modules under .pnpm get included
  // in the standalone output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Dev-only: allow loading HMR/dev resources when the studio is opened
  // via 127.0.0.1 or a LAN IP (not just localhost). Without this, Next 16
  // blocks cross-origin dev resources and the client bundle won't hydrate.
  allowedDevOrigins: ["127.0.0.1", "localhost"]
};

export default nextConfig;
