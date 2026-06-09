// Nessus importer — parses Tenable Nessus `.nessus` XML scan reports.
//
// Nessus reports cluster findings under <ReportItem> elements inside
// per-host <ReportHost> blocks. We emit one structured chunk per
// finding (host:port + severity + plugin name + synopsis) so the LLM
// can ground claims to the scanner output.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

const SEVERITY_LABEL: Record<string, string> = {
  "0": "Info",
  "1": "Low",
  "2": "Medium",
  "3": "High",
  "4": "Critical"
};

export const nessusImporter: Importer = {
  id: "nessus",
  displayName: "Nessus scan report",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    if (/<NessusClientData_v\d+/i.test(head)) return true;
    if (/<ReportHost\b/i.test(head) && /<ReportItem\b/i.test(head)) return true;
    return false;
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const content = artifact.content || "";
    const out: EvidenceChunk[] = [];
    let next = ctx.startIndex;

    const hostRegex = /<ReportHost\b([^>]*)>([\s\S]*?)<\/ReportHost>/gi;
    let hostMatch: RegExpExecArray | null;
    while ((hostMatch = hostRegex.exec(content))) {
      const hostAttrs = hostMatch[1];
      const hostBody = hostMatch[2];
      const hostName = attr(hostAttrs, "name") ?? "host";

      const itemRegex = /<ReportItem\b([^>]*)>([\s\S]*?)<\/ReportItem>/gi;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(hostBody))) {
        const a = itemMatch[1];
        const body = itemMatch[2];
        const port = attr(a, "port") ?? "0";
        const proto = attr(a, "protocol") ?? "tcp";
        const sev = attr(a, "severity") ?? "0";
        const pluginName = attr(a, "pluginName") ?? "";
        const synopsis = textOf(body, "synopsis");
        const sevLabel = SEVERITY_LABEL[sev] ?? sev;
        next += 1;
        out.push({
          id: formatChunkId(next),
          artifactId: artifact.id,
          artifactName: artifact.name,
          lineStart: 1,
          lineEnd: 1,
          text: `Nessus: ${hostName} ${port}/${proto} [${sevLabel}] ${pluginName}${synopsis ? ` — ${synopsis.slice(0, 200)}` : ""}`
        });
      }
    }

    return out;
  }
};

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = attrs.match(re);
  return m ? m[1] : null;
}

function textOf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
