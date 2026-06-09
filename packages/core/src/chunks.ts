// Evidence chunking + file-kind inference.
//
// Provenance starts here. Each chunk gets a stable, sequential ID
// (ev-001, ev-002, …) which the LLM cites and the validator scrubs. The
// chunk-ID stability is part of Verric's trust contract.
//
// For each artifact:
//   1. The first registered importer that detects the artifact emits
//      structured chunks (e.g. "Nmap: 10.10.10.5 port 22/tcp open ssh
//      — OpenSSH 7.2p2"). These give the LLM clean facts to ground to.
//   2. The raw content is line-chunked on top, so the model can also
//      cite the underlying source lines if it prefers.

import { defaultImporterRegistry, type ImporterRegistry, formatChunkId } from "./importers";
import type { EvidenceArtifact, EvidenceChunk, EvidenceKind } from "./types";

export function inferEvidenceKind(fileName: string, mimeType = ""): EvidenceKind {
  const name = fileName.toLowerCase();
  if (
    name.endsWith(".png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    mimeType.startsWith("image/")
  ) {
    return "image";
  }
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".json") || name.endsWith(".har")) return "json";
  if (name.endsWith(".xml") || name.endsWith(".nessus")) return "xml";
  if (name.endsWith(".md")) return "notes";
  if (/\.(txt|log|csv|http|req|res|jsonl)$/i.test(name) || mimeType.startsWith("text/")) return "text";
  return "unknown";
}

export interface BuildEvidenceChunksOptions {
  /** Override the importer set. Default: defaultImporterRegistry(). */
  importers?: ImporterRegistry;
  /** Hard cap on emitted chunks. Default: 180. */
  maxChunks?: number;
}

export function buildEvidenceChunks(
  artifacts: EvidenceArtifact[],
  manualNotes: string,
  options: BuildEvidenceChunksOptions = {}
): EvidenceChunk[] {
  const registry = options.importers ?? defaultImporterRegistry();
  const maxChunks = options.maxChunks ?? 180;

  const normalizedArtifacts = [...artifacts];
  if (manualNotes.trim()) {
    normalizedArtifacts.push({
      id: "manual-notes",
      name: "manual-notes.md",
      kind: "notes",
      type: "text/markdown",
      size: manualNotes.length,
      content: manualNotes
    });
  }

  const chunks: EvidenceChunk[] = [];
  for (const artifact of normalizedArtifacts) {
    if (artifact.kind === "image" || artifact.kind === "pdf") {
      chunks.push({
        id: formatChunkId(chunks.length + 1),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: 1,
        lineEnd: 1,
        text: `${artifact.kind.toUpperCase()} artifact supplied: ${artifact.name}`
      });
      continue;
    }

    const content = artifact.content || "";

    // 1. Structured chunks from the matching importer (if any).
    const importer = registry.findMatch(artifact);
    if (importer) {
      const structured = importer.importChunks(artifact, { startIndex: chunks.length });
      for (const c of structured) {
        chunks.push(c);
      }
    }

    // 2. Raw-line chunks on top.
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      chunks.push({
        id: formatChunkId(chunks.length + 1),
        artifactId: artifact.id,
        artifactName: artifact.name,
        lineStart: index + 1,
        lineEnd: index + 1,
        text: line
      });
    });
  }

  return chunks.slice(0, maxChunks);
}

export function chunkEvidence(rawEvidence: string): EvidenceChunk[] {
  return buildEvidenceChunks(
    [
      {
        id: "raw-evidence",
        name: "raw-evidence.txt",
        kind: "text",
        type: "text/plain",
        size: rawEvidence.length,
        content: rawEvidence
      }
    ],
    ""
  );
}
