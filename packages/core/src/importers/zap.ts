// OWASP ZAP importer — parses ZAP's JSON-format report
// (`zap-cli report -o report.json -f json`) and traditional JSON
// reports from the ZAP UI.
//
// Schema looks like:
//   { site: [{ "@host": "…", alerts: [{ alert, riskdesc, instances:
//     [{ uri, method }], ... }] }] }

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

interface ZapInstance {
  uri?: string;
  method?: string;
}
interface ZapAlert {
  alert?: string;
  name?: string;
  riskdesc?: string;
  risk?: string;
  riskcode?: string;
  desc?: string;
  description?: string;
  instances?: ZapInstance[];
}
interface ZapSite {
  "@host"?: string;
  host?: string;
  "@name"?: string;
  alerts?: ZapAlert[];
}
interface ZapReport {
  site?: ZapSite[] | ZapSite;
}

export const zapImporter: Importer = {
  id: "zap",
  displayName: "OWASP ZAP report",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 4000);
    if (!head.trim().startsWith("{")) return false;
    return /"site"\s*:|"@host"\s*:|"riskdesc"\s*:/i.test(head);
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const out: EvidenceChunk[] = [];
    let parsed: ZapReport | null = null;
    try {
      parsed = JSON.parse(artifact.content || "{}") as ZapReport;
    } catch {
      return out;
    }
    if (!parsed?.site) return out;
    const sites = Array.isArray(parsed.site) ? parsed.site : [parsed.site];

    let next = ctx.startIndex;
    for (const site of sites) {
      const host = site["@host"] || site.host || site["@name"] || "site";
      const alerts = Array.isArray(site.alerts) ? site.alerts : [];
      for (const alert of alerts) {
        const name = alert.alert || alert.name || "(unnamed alert)";
        const risk = (alert.riskdesc || alert.risk || alert.riskcode || "").toString().split(/[\s(]/)[0];
        const inst = alert.instances?.[0];
        const where = inst ? `${inst.method ?? "GET"} ${inst.uri ?? ""}` : "";
        next += 1;
        out.push({
          id: formatChunkId(next),
          artifactId: artifact.id,
          artifactName: artifact.name,
          lineStart: 1,
          lineEnd: 1,
          text: `ZAP: ${risk ? `[${risk}] ` : ""}${name} @ ${host}${where ? ` ${where}` : ""}`
        });
      }
    }
    return out;
  }
};
