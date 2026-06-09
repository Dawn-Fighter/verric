// PagerDuty importer — parses PagerDuty incident JSON exports (single
// incident OR list response from /incidents).

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

interface PagerDutyIncident {
  id?: string;
  incident_number?: number;
  title?: string;
  description?: string;
  status?: string;
  urgency?: string;
  created_at?: string;
  resolved_at?: string;
  service?: { summary?: string; name?: string };
  assignments?: Array<{ assignee?: { summary?: string } }>;
}

export const pagerdutyImporter: Importer = {
  id: "pagerduty",
  displayName: "PagerDuty incidents",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    if (!head.trim().startsWith("{") && !head.trim().startsWith("[")) return false;
    return /"incident"|"incidents"|"incident_number"|"pagerduty"/i.test(head);
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const out: EvidenceChunk[] = [];
    let incidents: PagerDutyIncident[] = [];
    try {
      const parsed = JSON.parse(artifact.content || "{}") as
        | PagerDutyIncident
        | PagerDutyIncident[]
        | { incidents?: PagerDutyIncident[]; incident?: PagerDutyIncident };
      if (Array.isArray(parsed)) {
        incidents = parsed;
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray((parsed as { incidents?: unknown }).incidents)) {
          incidents = (parsed as { incidents: PagerDutyIncident[] }).incidents;
        } else if ((parsed as { incident?: PagerDutyIncident }).incident) {
          incidents = [(parsed as { incident: PagerDutyIncident }).incident];
        } else if ((parsed as PagerDutyIncident).incident_number != null) {
          incidents = [parsed as PagerDutyIncident];
        }
      }
    } catch {
      return out;
    }
    let next = ctx.startIndex;
    for (const inc of incidents) {
      const num = inc.incident_number != null ? `#${inc.incident_number}` : (inc.id ?? "");
      const title = inc.title ?? inc.description ?? "(untitled)";
      const status = inc.status ?? "";
      const urgency = inc.urgency ?? "";
      const service = inc.service?.summary || inc.service?.name || "";
      const assignee = inc.assignments?.[0]?.assignee?.summary ?? "";
      const created = inc.created_at ?? "";
      const resolved = inc.resolved_at ?? "";
      next += 1;
      out.push({
        id: formatChunkId(next),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `PagerDuty ${num} [${urgency}/${status}] ${title}${service ? ` · ${service}` : ""}${assignee ? ` · @${assignee}` : ""}${created ? ` · created ${created}` : ""}${resolved ? ` · resolved ${resolved}` : ""}`
      });
    }
    return out;
  }
};
