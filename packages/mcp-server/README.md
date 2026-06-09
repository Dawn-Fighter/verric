# @verric/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Verric's runs, reports, evidence, and receipts as MCP tools and resources. Coding agents (Cursor, Claude Code, opencode) can query the server for grounded report context instead of hallucinating about your team's report history.

## Tools

| Tool | Description |
|---|---|
| `verric_list_runs` | List recent runs in reverse chronological order |
| `verric_get_run` | Full run: project, evidence chunks, report, verdicts, receipt |
| `verric_list_run_events` | Progress-event log for a run (debugging) |
| `verric_verify_receipt` | Independently verify a receipt's signature + digests |

## Resources

| URI | Content |
|---|---|
| `verric://runs` | Last 100 runs (summary) |
| `verric://runs/<id>` | Full run detail |

## Configuration

Connect to the same SQLite database the web app/CLI write to:

```bash
VERRIC_DB_PATH=/path/to/verric.db verric-mcp
```

If `VERRIC_DB_PATH` is unset the server defaults to `./verric.db`.

## Wiring it up

### Claude Code / opencode

```json
{
  "mcpServers": {
    "verric": {
      "command": "verric-mcp",
      "env": { "VERRIC_DB_PATH": "/data/verric/verric.db" }
    }
  }
}
```

### Cursor

```json
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
