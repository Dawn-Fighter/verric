// Stdio entry point for the Verric MCP server. Launched by MCP clients
// (Cursor, Claude Code, opencode, etc.) as a subprocess.

import { createVerricMcpServer } from "./index";

const server = createVerricMcpServer();
server.start().catch((err) => {
  process.stderr.write(`verric-mcp fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});

const shutdown = async () => {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
