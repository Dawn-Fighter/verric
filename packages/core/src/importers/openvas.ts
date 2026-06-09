// OpenVAS / Greenbone GVM importer — parses XML scan reports
// (`gvm-cli ... --xml '<get_reports report_id="…"/>'` or .xml downloads
// from the web UI).
//
// Each <result> element is one finding. We pull host, port, NVT name,
// severity, and the threat label.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

export const openvasImporter: Importer = {
  id: "openvas",
  displayName: "OpenVAS / Greenbone GVM report",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    if (/<report\b/i.test(head) && /<result\b/i.test(head)) return true;
    if (/<get_reports_response\b/i.test(head)) return true;
    return false;
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const content = artifact.content || "";
    const out: EvidenceChunk[] = [];
    let next = ctx.startIndex;

    const resultRegex = /<result\b[^>]*>([\s\S]*?)<\/result>/gi;
    let match: RegExpExecArray | null;
    while ((match = resultRegex.exec(content))) {
      const body = match[1];
      const host = textOf(body, "host") ?? "host";
      const port = textOf(body, "port") ?? "general/tcp";
      const threat = textOf(body, "threat") ?? "";
      const severity = textOf(body, "severity") ?? "";
      const nvtName = nvtName2(body) ?? textOf(body, "name") ?? "(unnamed nvt)";
      next += 1;
      out.push({
        id: formatChunkId(next),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `OpenVAS: ${host} ${port} [${threat || severity || "Log"}] ${nvtName}`
      });
    }

    return out;
  }
};

function textOf(block: string, tag: string): string | null {
  // Use a non-greedy match anchored by an exact closing tag. Skip cases
  // where the tag is self-closing.
  const re = new RegExp(`<${tag}\\b[^/>]*>([\\s\\S]*?)</${tag}>`, "i");
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

/** OpenVAS nests the NVT name in <nvt><name>…</name></nvt>. */
function nvtName2(block: string): string | null {
  const m = block.match(/<nvt\b[^>]*>([\s\S]*?)<\/nvt>/i);
  if (!m) return null;
  return textOf(m[1], "name");
}
