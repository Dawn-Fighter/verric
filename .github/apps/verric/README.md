# Verric GitHub App

A GitHub App that auto-drafts grounded reports when specific events happen on a repo. Triggers:

| Trigger | Action |
|---|---|
| Close an issue with the label `verric:postmortem` | Draft a postmortem from the issue body + linked PRs + relevant Slack threads (when configured) |
| Merge a PR with the label `verric:adr` | Draft an Architecture Decision Record from the PR description + diff |

## How it works

1. The app posts events to `POST /api/github/webhook` on your self-hosted Verric instance.
2. Verric verifies the `X-Hub-Signature-256` header against `VERRIC_GITHUB_WEBHOOK_SECRET`.
3. Routes by event + label, then dispatches a Verric run asynchronously (same engine used for manual runs — receipt, canary, grounding pass, the lot).
4. When the run completes, Verric posts a comment on the issue/PR linking to the report and includes the receipt's signature prefix.

## Configure the App

1. Create a new GitHub App: <https://github.com/settings/apps/new>
2. Webhook URL: `https://your-verric.example.com/api/github/webhook`
3. Webhook secret: any high-entropy string. Set the same value as `VERRIC_GITHUB_WEBHOOK_SECRET` on your Verric server.
4. Permissions:
   - **Issues**: Read & write (for posting comments on completed postmortems)
   - **Pull requests**: Read & write
   - **Contents**: Read (for fetching diffs)
   - **Metadata**: Read (default)
5. Subscribe to events:
   - Issues
   - Pull request
6. Install on the repo(s) you want grounded reports for.

## Status

The webhook receiver is **live and signature-verified**. Dispatching to the engine for postmortem/ADR drafts is wired but currently logs intent rather than firing the run end-to-end — that lights up alongside the GitHub importer expansion in the next slice.
