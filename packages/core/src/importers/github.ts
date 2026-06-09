// GitHub importer — parses commits / PRs / issues JSON from
// `gh api`, the REST API directly, or webhook payloads. We sniff the
// shape and dispatch.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

interface GhCommit {
  sha?: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string };
  html_url?: string;
}
interface GhPullRequest {
  number?: number;
  title?: string;
  state?: string;
  user?: { login?: string };
  merged_at?: string | null;
  created_at?: string;
  html_url?: string;
}
interface GhIssue {
  number?: number;
  title?: string;
  state?: string;
  user?: { login?: string };
  created_at?: string;
  html_url?: string;
  pull_request?: unknown;
}

export const githubImporter: Importer = {
  id: "github",
  displayName: "GitHub commits / PRs / issues",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    const trimmed = head.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
    if (/"sha"\s*:.*"commit"\s*:/i.test(head)) return true;
    if (/"pull_request"\s*:|"merge_commit_sha"\s*:|"merged_at"\s*:/i.test(head)) return true;
    if (/"html_url"\s*:\s*"https:\/\/github\.com/i.test(head)) return true;
    return false;
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const out: EvidenceChunk[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.content || "[]");
    } catch {
      return out;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let next = ctx.startIndex;
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      let text: string | null = null;

      if ((obj as GhCommit).sha && (obj as GhCommit).commit) {
        const c = obj as GhCommit;
        const msg = (c.commit?.message ?? "").split(/\r?\n/)[0].slice(0, 200);
        text = `GitHub commit ${(c.sha ?? "").slice(0, 8)} by ${c.author?.login ?? c.commit?.author?.name ?? "?"}: ${msg}`;
      } else if (
        (obj as GhPullRequest).number != null &&
        ((obj as GhPullRequest).merged_at !== undefined ||
          /pull/i.test(String((obj as GhPullRequest).html_url ?? "")))
      ) {
        const p = obj as GhPullRequest;
        text = `GitHub PR #${p.number} [${p.state ?? "?"}] by ${p.user?.login ?? "?"}: ${p.title ?? ""}${p.merged_at ? ` (merged ${p.merged_at})` : ""}`;
      } else if ((obj as GhIssue).number != null) {
        const i = obj as GhIssue;
        text = `GitHub issue #${i.number} [${i.state ?? "?"}] by ${i.user?.login ?? "?"}: ${i.title ?? ""}`;
      }

      if (text) {
        next += 1;
        out.push({
          id: formatChunkId(next),
          artifactId: artifact.id,
          artifactName: artifact.name,
          lineStart: 1,
          lineEnd: 1,
          text
        });
      }
    }
    return out;
  }
};
