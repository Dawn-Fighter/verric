// Burp Suite importer — parses Burp's XML "Issue Definition" exports
// AND raw HTTP request/response captures saved as .http files.
//
// Burp pros export issues from "Site map → Issues → Save selected issues"
// as XML; testers also save individual request/response pairs as plain
// HTTP. Both flows show up in pentest evidence; we handle both.
//
// We deliberately avoid pulling in an XML parser dep — Burp's output is
// well-formed enough that targeted regex extraction is reliable for the
// fields we care about (host, path, severity, name, host context).

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

export const burpImporter: Importer = {
  id: "burp",
  displayName: "Burp Suite issue / HTTP capture",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    if (/<issues\b/i.test(head)) return true;
    if (/<issue\b/i.test(head) && /<name>/i.test(head)) return true;
    // Raw HTTP request capture: `Request: GET /…` style or a plain
    // request/response pair we recognize.
    if (/^Request:\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/im.test(head)) return true;
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^\s]+ HTTP\/\d/im.test(head)) {
      return /HTTP\/\d\.\d \d{3}/i.test(head);
    }
    return false;
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const content = artifact.content || "";
    const out: EvidenceChunk[] = [];
    let next = ctx.startIndex;
    const push = (text: string) => {
      next += 1;
      out.push({
        id: formatChunkId(next),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text
      });
    };

    // 1. XML <issues> export — pull out each <issue> block.
    const issueRegex = /<issue\b[\s\S]*?<\/issue>/gi;
    const issues = content.match(issueRegex);
    if (issues) {
      for (const block of issues) {
        const name = textOf(block, "name");
        const severity = textOf(block, "severity");
        const host = textOf(block, "host");
        const path = textOf(block, "path");
        const issueDetail = textOf(block, "issueDetail");
        if (name) {
          push(
            `Burp issue: ${severity ? `[${severity}] ` : ""}${name}${host ? ` @ ${host}` : ""}${path ? path : ""}${issueDetail ? ` — ${issueDetail.slice(0, 200)}` : ""}`
          );
        }
      }
      return out;
    }

    // 2. Raw HTTP request/response capture.
    const reqMatch = content.match(
      /(?:^|\n)(?:Request:\s+)?((?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^\s]+ HTTP\/\d\.\d)/i
    );
    const resMatch = content.match(/HTTP\/\d\.\d (\d{3})(?: ([^\r\n]+))?/i);
    if (reqMatch) {
      const requestLine = reqMatch[1].trim();
      push(`Burp request: ${requestLine}`);
    }
    if (resMatch) {
      push(`Burp response: HTTP ${resMatch[1]}${resMatch[2] ? ` ${resMatch[2].trim()}` : ""}`);
    }
    // Bare "Request:/Response:" prose form.
    const proseReq = content.match(/^Request:\s*(.+)$/im);
    const proseRes = content.match(/^Response:\s*(.+)$/im);
    if (!reqMatch && proseReq) push(`Burp request: ${proseReq[1].trim().slice(0, 240)}`);
    if (!resMatch && proseRes) push(`Burp response: ${proseRes[1].trim().slice(0, 240)}`);

    return out;
  }
};

function textOf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
