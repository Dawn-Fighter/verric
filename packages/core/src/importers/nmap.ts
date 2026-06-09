// Nmap importer — turns `nmap -sV` output into structured port-level
// chunks the LLM can ground claims to.

import type { Importer, ImporterContext } from "./types";
import { formatChunkId } from "./types";
import { isNmapContent, parseNmap } from "../nmap";
import type { EvidenceArtifact, EvidenceChunk } from "../types";

export const nmapImporter: Importer = {
  id: "nmap",
  displayName: "Nmap scan output",
  detect(artifact: EvidenceArtifact): boolean {
    if (!artifact.content) return false;
    if (artifact.kind === "image" || artifact.kind === "pdf") return false;
    return isNmapContent(artifact.content);
  },
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[] {
    const content = artifact.content || "";
    const hosts = parseNmap(content);
    const chunks: EvidenceChunk[] = [];
    let next = ctx.startIndex;
    for (const host of hosts) {
      const target = host.ip || host.host || "host";
      for (const port of host.ports) {
        next += 1;
        chunks.push({
          id: formatChunkId(next),
          artifactId: artifact.id,
          artifactName: artifact.name,
          lineStart: 1,
          lineEnd: 1,
          text: `Nmap: ${target} port ${port.port}/${port.proto} ${port.state} ${port.service}${port.version ? ` — ${port.version}` : ""}`
        });
      }
    }
    return chunks;
  }
};
