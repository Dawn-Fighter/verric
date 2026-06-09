// Slack importer — parses Slack channel exports (the JSON files Slack
// emits when you "Export workspace") and individual message dumps.
//
// Each emitted chunk is one Slack message: timestamp, user, text, with
// the channel name prefixed. The LLM grounds incident-timeline claims
// against these messages.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

interface SlackMessage {
  ts?: string;
  user?: string;
  user_profile?: { real_name?: string; display_name?: string };
  bot_id?: string;
  username?: string;
  text?: string;
  type?: string;
  subtype?: string;
}

export const slackImporter: Importer = {
  id: "slack",
  displayName: "Slack channel export",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 6000).trim();
    if (!head) return false;
    if (!head.startsWith("[")) return false;
    // Slack JSON exports are arrays of message objects with characteristic keys.
    return /"ts"\s*:|"user"\s*:|"channel"\s*:|"user_profile"\s*:/i.test(head);
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const out: EvidenceChunk[] = [];
    let messages: SlackMessage[] = [];
    try {
      const parsed = JSON.parse(artifact.content || "[]") as unknown;
      if (Array.isArray(parsed)) messages = parsed as SlackMessage[];
    } catch {
      return out;
    }
    const channel = inferChannelFromName(artifact.name);
    let next = ctx.startIndex;
    for (const m of messages) {
      if (!m.text) continue;
      // Skip system noise.
      if (m.subtype === "channel_join" || m.subtype === "channel_leave") continue;
      const author =
        m.user_profile?.display_name ||
        m.user_profile?.real_name ||
        m.username ||
        m.user ||
        m.bot_id ||
        "user";
      const time = m.ts ? formatSlackTs(m.ts) : "";
      next += 1;
      out.push({
        id: formatChunkId(next),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `Slack #${channel} ${time} ${author}: ${m.text.replace(/\s+/g, " ").slice(0, 400)}`
      });
    }
    return out;
  }
};

function inferChannelFromName(name: string): string {
  // Common patterns: "incident-12345.json", "p2-outage-2026-01-01.json"
  return name.replace(/\.json$/i, "").replace(/[_-]+/g, "-");
}

function formatSlackTs(ts: string): string {
  // Slack ts is "secondsSinceEpoch.microseconds"
  const seconds = Math.floor(Number.parseFloat(ts));
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}
