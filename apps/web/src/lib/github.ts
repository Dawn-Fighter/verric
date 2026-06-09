// Helpers for the GitHub webhook handler — fetch the issue + comments
// + linked PRs from the GitHub REST API and turn them into evidence
// chunks the engine can ground a postmortem against.
//
// The GitHub token used here is the GitHub App's installation token in
// production. For self-host with a single PAT, set VERRIC_GITHUB_TOKEN.

import type { EvidenceArtifact } from "@verric/core";

interface GhIssueComment {
  id?: number;
  user?: { login?: string };
  created_at?: string;
  body?: string;
}

interface GhIssue {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  user?: { login?: string };
  created_at?: string;
  closed_at?: string | null;
  labels?: Array<{ name?: string }>;
  html_url?: string;
}

export async function fetchIssueEvidence(
  repoFullName: string,
  issueNumber: number,
  token?: string
): Promise<EvidenceArtifact[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: EvidenceArtifact[] = [];

  // Issue body
  const issueRes = await fetch(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`, {
    headers
  });
  if (!issueRes.ok) {
    throw new Error(`GitHub issue fetch failed (${issueRes.status})`);
  }
  const issue = (await issueRes.json()) as GhIssue;
  const issueText = formatIssueArtifact(repoFullName, issue);
  out.push({
    id: `gh-issue-${issueNumber}`,
    name: `issue-${issueNumber}.md`,
    kind: "notes",
    type: "text/markdown",
    size: issueText.length,
    content: issueText
  });

  // Comments
  const commentsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`,
    { headers }
  );
  if (commentsRes.ok) {
    const comments = (await commentsRes.json()) as GhIssueComment[];
    if (comments.length > 0) {
      const text = comments
        .map((c) => `${c.created_at ?? ""} @${c.user?.login ?? "?"}:\n${(c.body ?? "").trim()}`)
        .join("\n\n---\n\n");
      out.push({
        id: `gh-issue-${issueNumber}-comments`,
        name: `issue-${issueNumber}-comments.md`,
        kind: "notes",
        type: "text/markdown",
        size: text.length,
        content: text.slice(0, 160000)
      });
    }
  }

  return out;
}

function formatIssueArtifact(repo: string, issue: GhIssue): string {
  const head = `# ${repo}#${issue.number}: ${issue.title ?? ""}`;
  const meta = [
    `Author: @${issue.user?.login ?? "?"}`,
    `Created: ${issue.created_at ?? "?"}`,
    issue.closed_at ? `Closed: ${issue.closed_at}` : null,
    issue.html_url ? `URL: ${issue.html_url}` : null
  ]
    .filter((s): s is string => Boolean(s))
    .join(" · ");
  const body = (issue.body ?? "").trim();
  return [head, meta, "", body].join("\n").slice(0, 160000);
}

// ─────────────────────────────────────────────────────────────────────────
// Pull-request evidence (for the ADR template)
// ─────────────────────────────────────────────────────────────────────────

interface GhPull {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  merged?: boolean;
  user?: { login?: string };
  created_at?: string;
  merged_at?: string | null;
  base?: { ref?: string };
  head?: { ref?: string };
  html_url?: string;
}
interface GhCommit {
  sha?: string;
  commit?: { message?: string };
}
interface GhFile {
  filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

/**
 * Pack a merged PR into evidence artifacts for the ADR template: the PR
 * description, the commit messages, and the changed-files summary. We
 * deliberately fetch the files LIST (not full patches) to bound size —
 * the decision rationale lives in the description + commits, and the
 * file list is enough structural context.
 */
export async function fetchPullRequestEvidence(
  repoFullName: string,
  prNumber: number,
  token?: string
): Promise<EvidenceArtifact[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out: EvidenceArtifact[] = [];

  const prRes = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`, { headers });
  if (!prRes.ok) throw new Error(`GitHub PR fetch failed (${prRes.status})`);
  const pr = (await prRes.json()) as GhPull;
  const prText = [
    `# ${repoFullName} PR #${pr.number}: ${pr.title ?? ""}`,
    [
      `Author: @${pr.user?.login ?? "?"}`,
      pr.base?.ref && pr.head?.ref ? `${pr.head.ref} → ${pr.base.ref}` : null,
      pr.merged_at ? `Merged: ${pr.merged_at}` : null,
      pr.html_url ? `URL: ${pr.html_url}` : null
    ]
      .filter((s): s is string => Boolean(s))
      .join(" · "),
    "",
    (pr.body ?? "").trim()
  ].join("\n");
  out.push({
    id: `gh-pr-${prNumber}`,
    name: `pr-${prNumber}.md`,
    kind: "notes",
    type: "text/markdown",
    size: prText.length,
    content: prText.slice(0, 160000)
  });

  const commitsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/commits?per_page=100`,
    { headers }
  );
  if (commitsRes.ok) {
    const commits = (await commitsRes.json()) as GhCommit[];
    if (commits.length > 0) {
      const text = commits
        .map((c) => `${(c.sha ?? "").slice(0, 8)}: ${(c.commit?.message ?? "").split(/\r?\n/)[0]}`)
        .join("\n");
      out.push({
        id: `gh-pr-${prNumber}-commits`,
        name: `pr-${prNumber}-commits.md`,
        kind: "notes",
        type: "text/markdown",
        size: text.length,
        content: text.slice(0, 80000)
      });
    }
  }

  const filesRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/files?per_page=100`,
    { headers }
  );
  if (filesRes.ok) {
    const files = (await filesRes.json()) as GhFile[];
    if (files.length > 0) {
      const text = files
        .map((f) => `${f.status ?? "?"} ${f.filename ?? "?"} (+${f.additions ?? 0}/-${f.deletions ?? 0})`)
        .join("\n");
      out.push({
        id: `gh-pr-${prNumber}-files`,
        name: `pr-${prNumber}-files.md`,
        kind: "notes",
        type: "text/markdown",
        size: text.length,
        content: text.slice(0, 40000)
      });
    }
  }

  return out;
}

export async function postIssueComment(
  repoFullName: string,
  issueNumber: number,
  body: string,
  token: string
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    throw new Error(`GitHub comment failed (${res.status})`);
  }
}
