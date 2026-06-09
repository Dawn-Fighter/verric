// Nuclei importer — parses ProjectDiscovery Nuclei JSONL output
// (`nuclei -jsonl -o results.jsonl`) and JSON arrays.
//
// Each line in the JSONL file is one finding. We accept both forms
// (line-delimited and a single JSON array) for tester convenience.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

interface NucleiFinding {
  "template-id"?: string;
  templateID?: string; // older versions
  type?: string;
  host?: string;
  "matched-at"?: string;
  matched?: string;
  info?: {
    name?: string;
    severity?: string;
    description?: string;
  };
}

export const nucleiImporter: Importer = {
  id: "nuclei",
  displayName: "Nuclei JSON/JSONL output",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    const head = artifact.content.slice(0, 6000).trim();
    if (!head) return false;
    // JSONL: each line is a JSON object. JSON: starts with [ and contains objects.
    if (head.startsWith("[")) {
      return /"template-?id"|"templateID"/i.test(head);
    }
    if (head.startsWith("{")) {
      return /"template-?id"|"templateID"/i.test(head);
    }
    return false;
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const content = artifact.content || "";
    const findings = parseFindings(content);
    const out: EvidenceChunk[] = [];
    let next = ctx.startIndex;
    for (const f of findings) {
      const id = f["template-id"] || f.templateID || "unknown-template";
      const name = f.info?.name ?? id;
      const sev = f.info?.severity ?? "info";
      const host = f.host ?? f["matched-at"] ?? f.matched ?? "";
      next += 1;
      out.push({
        id: formatChunkId(next),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `Nuclei: [${sev}] ${name} (${id})${host ? ` @ ${host}` : ""}`
      });
    }
    return out;
  }
};

function parseFindings(content: string): NucleiFinding[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  // JSON array
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) return arr as NucleiFinding[];
    } catch {
      // fall through to JSONL parsing
    }
  }
  // JSONL: one finding per line
  const out: NucleiFinding[] = [];
  for (const raw of trimmed.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line) as NucleiFinding);
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}
