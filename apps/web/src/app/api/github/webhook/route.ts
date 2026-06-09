import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  adrTemplate,
  buildEvidenceChunks,
  postmortemTemplate,
  providerFromConfig,
  type ProjectDetails,
  type ReportTemplate
} from "@verric/core";
import { createPendingRun, findOrCreateProject } from "@verric/storage";
import { getDb } from "@/lib/db";
import { processRun } from "@/lib/worker";
import { fetchIssueEvidence, fetchPullRequestEvidence, postIssueComment } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// POST /api/github/webhook
//
// GitHub App webhook receiver. Verifies the X-Hub-Signature-256 header
// against VERRIC_GITHUB_WEBHOOK_SECRET (HMAC-SHA-256 of the raw body),
// then dispatches by event type:
//
//   - issues.closed (label includes "verric:postmortem")
//       → fetch issue body + comments via GitHub API, build evidence,
//         queue a postmortem run, post a "report ready" comment back
//         with the receipt signature when the run completes.
//
//   - pull_request.closed (label includes "verric:adr")
//       → kick off an ADR draft from the PR description + diff. (TODO)
// ─────────────────────────────────────────────────────────────────────────

interface GhIssuesPayload {
  action?: string;
  issue?: { number?: number; title?: string; body?: string; labels?: Array<{ name?: string }> };
  repository?: { full_name?: string };
}

interface GhPullRequestPayload {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    labels?: Array<{ name?: string }>;
    merged?: boolean;
  };
  repository?: { full_name?: string };
}

export async function POST(request: Request) {
  const secret = process.env.VERRIC_GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "GitHub webhook is not configured",
        hint: "Set VERRIC_GITHUB_WEBHOOK_SECRET to the value you configured on the GitHub App."
      },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(secret, rawBody, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event === "ping") {
    return NextResponse.json({ ok: true, pong: true });
  }

  if (event === "issues") {
    const p = payload as GhIssuesPayload;
    if (
      p.action === "closed" &&
      labelsInclude(p.issue?.labels, "verric:postmortem") &&
      p.issue?.number != null &&
      p.repository?.full_name
    ) {
      const repoFullName = p.repository.full_name;
      const issueNumber = p.issue.number;
      // Fire and forget: respond 200 quickly so GitHub doesn't retry.
      void dispatchPostmortemRun(repoFullName, issueNumber, p.issue.title ?? "").catch((err) => {
        console.error(`[verric/webhook] postmortem dispatch failed for ${repoFullName}#${issueNumber}:`, err);
      });
      return NextResponse.json({
        ok: true,
        dispatched: "postmortem",
        repo: repoFullName,
        issue: issueNumber
      });
    }
  }

  if (event === "pull_request") {
    const p = payload as GhPullRequestPayload;
    if (
      p.action === "closed" &&
      p.pull_request?.merged &&
      labelsInclude(p.pull_request.labels, "verric:adr") &&
      p.pull_request.number != null &&
      p.repository?.full_name
    ) {
      const repoFullName = p.repository.full_name;
      const prNumber = p.pull_request.number;
      const prTitle = p.pull_request.title ?? "";
      void dispatchAdrRun(repoFullName, prNumber, prTitle).catch((err) => {
        console.error(`[verric/webhook] ADR dispatch failed for ${repoFullName}#${prNumber}:`, err);
      });
      return NextResponse.json({
        ok: true,
        dispatched: "adr",
        repo: repoFullName,
        pr: prNumber
      });
    }
  }

  return NextResponse.json({ ok: true, ignored: event });
}

// ─────────────────────────────────────────────────────────────────────────
// Run dispatch — shared by the postmortem (issue) and ADR (PR) paths
// ─────────────────────────────────────────────────────────────────────────

function providerFromEnv() {
  // Pick a provider from env. If misconfigured this throws, so the run
  // row is never created — matching the "real provider or honest failure"
  // contract.
  return providerFromConfig({
    provider: (process.env.VERRIC_PROVIDER as "openai" | "anthropic" | "ollama" | undefined) || undefined,
    apiKey:
      process.env.VERRIC_PROVIDER === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY,
    model:
      process.env.VERRIC_PROVIDER === "anthropic"
        ? process.env.ANTHROPIC_MODEL
        : process.env.VERRIC_PROVIDER === "ollama"
          ? process.env.OLLAMA_MODEL
          : process.env.OPENAI_MODEL,
    baseUrl:
      process.env.VERRIC_PROVIDER === "ollama" ? process.env.OLLAMA_BASE_URL : process.env.OPENAI_BASE_URL
  });
}

interface DispatchOptions {
  repoFullName: string;
  /** issue or PR number — used in the comment-back and project scope. */
  number: number;
  template: ReportTemplate;
  project: ProjectDetails;
  artifacts: Awaited<ReturnType<typeof fetchIssueEvidence>>;
  /** "issue" → comment via issues API; "pull" → comment on the PR (same endpoint). */
  label: string;
}

async function dispatchRun(opts: DispatchOptions): Promise<void> {
  const ghToken = process.env.VERRIC_GITHUB_TOKEN;
  const chunks = buildEvidenceChunks(opts.artifacts, "");
  if (chunks.length === 0) {
    console.warn(`[verric/webhook] no evidence chunks for ${opts.repoFullName}#${opts.number}`);
    return;
  }

  const provider = providerFromEnv();
  const db = getDb();
  const projectRow = findOrCreateProject(db, opts.project);
  const runId = createPendingRun(db, {
    projectId: projectRow.id,
    template: opts.template.id,
    providerId: provider.id,
    model: provider.model,
    chunks,
    artifacts: opts.artifacts
  });

  await processRun(db, {
    runId,
    provider,
    signingKey: process.env.VERRIC_SIGNING_KEY || "verric-unsigned",
    template: opts.template.id
  });

  // Comment back (issues + PRs share the /issues/:n/comments endpoint).
  if (ghToken) {
    const base = process.env.VERRIC_PUBLIC_URL?.replace(/\/$/, "") || "http://localhost:3000";
    try {
      await postIssueComment(
        opts.repoFullName,
        opts.number,
        [
          `📑 **Verric ${opts.label} ready**`,
          ``,
          `Run: ${base}/runs/${runId}`,
          `API: ${base}/api/runs/${runId}`,
          ``,
          `_Real provider or honest failure — every claim cites evidence. Cryptographic receipt attached to the run._`
        ].join("\n"),
        ghToken
      );
    } catch (err) {
      console.error(`[verric/webhook] comment-back failed for ${opts.repoFullName}#${opts.number}:`, err);
    }
  }
}

async function dispatchPostmortemRun(
  repoFullName: string,
  issueNumber: number,
  issueTitle: string
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const project: ProjectDetails = {
    clientName: repoFullName,
    projectName: `Postmortem: ${issueTitle.slice(0, 80) || `#${issueNumber}`}`,
    assessmentType: "Incident postmortem",
    preparedBy: "Verric",
    testerName: "GitHub App auto-draft",
    classification: "Internal",
    startDate: today,
    endDate: today,
    reportDate: today,
    scope: `${repoFullName}#${issueNumber}`,
    outOfScope: "",
    rulesOfEngagement: "",
    methodology: "Slack/log timeline reconstruction",
    toolsUsed: "GitHub Issues"
  };
  const artifacts = await fetchIssueEvidence(repoFullName, issueNumber, process.env.VERRIC_GITHUB_TOKEN);
  await dispatchRun({
    repoFullName,
    number: issueNumber,
    template: postmortemTemplate,
    project,
    artifacts,
    label: "postmortem"
  });
}

async function dispatchAdrRun(repoFullName: string, prNumber: number, prTitle: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const project: ProjectDetails = {
    clientName: repoFullName,
    projectName: `ADR: ${prTitle.slice(0, 80) || `PR #${prNumber}`}`,
    assessmentType: "Architecture Decision Record",
    preparedBy: "Verric",
    testerName: "GitHub App auto-draft",
    classification: "Internal",
    startDate: today,
    endDate: today,
    reportDate: today,
    scope: `${repoFullName}#${prNumber}`,
    outOfScope: "",
    rulesOfEngagement: "",
    methodology: "PR review + commit analysis",
    toolsUsed: "GitHub Pull Requests"
  };
  const artifacts = await fetchPullRequestEvidence(repoFullName, prNumber, process.env.VERRIC_GITHUB_TOKEN);
  await dispatchRun({
    repoFullName,
    number: prNumber,
    template: adrTemplate,
    project,
    artifacts,
    label: "ADR"
  });
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

function verifySignature(secret: string, body: string, header: string): boolean {
  if (!header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const got = header.slice(7);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

function labelsInclude(labels: Array<{ name?: string }> | undefined, target: string): boolean {
  return Array.isArray(labels) && labels.some((l) => (l.name ?? "").toLowerCase() === target);
}
