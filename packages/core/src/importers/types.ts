// Importer plugin interface.
//
// Importers turn raw evidence artifacts into STRUCTURED chunks the LLM
// can ground claims to. They run alongside the line-by-line raw chunker
// in chunks.ts — an artifact ends up with both kinds of chunks, which
// is the whole point: the model can cite either a parsed fact or the
// underlying raw line.
//
// A new importer is just a small object literal. The registry pattern
// means adding scanners (Burp, Nessus, Nuclei, ZAP, OpenVAS, …) is a
// non-breaking change: register them at engine-init time, the existing
// pipeline picks them up automatically.

import type { EvidenceArtifact, EvidenceChunk } from "../types";

export interface ImporterContext {
  /** Where the raw chunker has already advanced to. Importers should
   * number their own emitted chunks starting at startIndex + 1. */
  startIndex: number;
}

export interface Importer {
  /** Stable id used in receipts/logs, e.g. "nmap", "burp", "nessus". */
  readonly id: string;
  /** Human label for the studio's evidence-intake card. */
  readonly displayName: string;

  /**
   * Quick sniff. Should be cheap (regex on a slice of content). Return
   * true if this importer can extract structured facts from the
   * artifact — false otherwise.
   */
  detect(artifact: EvidenceArtifact): boolean;

  /**
   * Emit zero or more structured chunks for the artifact. These live
   * ALONGSIDE the raw-line chunks; the importer doesn't need to chunk
   * the raw text itself. Return [] if nothing structured to extract.
   *
   * Chunks should use sequential ids starting from
   * `ctx.startIndex + 1`, formatted as `ev-NNN`.
   */
  importChunks(artifact: EvidenceArtifact, ctx: ImporterContext): EvidenceChunk[];
}

/**
 * Format a chunk id as the canonical `ev-NNN` zero-padded form.
 * Importers should use this so id formatting stays consistent across
 * registries.
 */
export function formatChunkId(index: number): string {
  return `ev-${String(index).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mutable, ordered list of importers. Earlier importers run first. The
 * default registry is populated by the importers/index.ts barrel; tests
 * and embedders can build their own with a different set.
 */
export class ImporterRegistry {
  private importers: Importer[] = [];

  register(importer: Importer): this {
    // Replace any prior registration with the same id (idempotent).
    this.importers = this.importers.filter((i) => i.id !== importer.id);
    this.importers.push(importer);
    return this;
  }

  registerMany(importers: Importer[]): this {
    for (const i of importers) this.register(i);
    return this;
  }

  get(id: string): Importer | undefined {
    return this.importers.find((i) => i.id === id);
  }

  list(): readonly Importer[] {
    return [...this.importers];
  }

  /** Return the first importer that detects the artifact, or undefined. */
  findMatch(artifact: EvidenceArtifact): Importer | undefined {
    return this.importers.find((i) => i.detect(artifact));
  }
}
