import { describe, expect, it } from "vitest";
import { buildEvidenceChunks, inferEvidenceKind } from "./chunks";
import type { EvidenceArtifact } from "./types";

// buildEvidenceChunks is the foundation of provenance: every claim cites a
// chunk ID, so chunk-ID stability is part of the trust contract.

describe("inferEvidenceKind", () => {
  it.each([
    ["screenshot.png", "image/png", "image"],
    ["screenshot.PNG", "", "image"],
    ["report.pdf", "application/pdf", "pdf"],
    ["data.json", "application/json", "json"],
    ["session.har", "", "json"],
    ["sitemap.xml", "", "xml"],
    ["notes.md", "", "notes"],
    ["scan.txt", "", "text"],
    ["server.log", "", "text"],
    ["request.http", "", "text"],
    ["mystery.bin", "", "unknown"]
  ])("infers kind of %s correctly", (name, mime, expected) => {
    expect(inferEvidenceKind(name, mime)).toBe(expected);
  });

  it("falls back to text when MIME type starts with text/", () => {
    expect(inferEvidenceKind("anyfile", "text/plain")).toBe("text");
  });

  it("falls back to image when MIME type starts with image/", () => {
    expect(inferEvidenceKind("anyfile", "image/webp")).toBe("image");
  });
});

describe("buildEvidenceChunks", () => {
  it("returns an empty array when there are no artifacts and no notes", () => {
    expect(buildEvidenceChunks([], "")).toEqual([]);
  });

  it("appends manual notes as a synthetic 'manual-notes' artifact", () => {
    const chunks = buildEvidenceChunks([], "Tester saw a 200 on /admin without auth");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.artifactId === "manual-notes")).toBe(true);
    expect(chunks.every((c) => c.artifactName === "manual-notes.md")).toBe(true);
  });

  it("emits one placeholder chunk per image and per pdf artifact", () => {
    const artifacts: EvidenceArtifact[] = [
      { id: "img-1", name: "shot.png", kind: "image", type: "image/png", size: 100 },
      { id: "pdf-1", name: "report.pdf", kind: "pdf", type: "application/pdf", size: 200 }
    ];
    const chunks = buildEvidenceChunks(artifacts, "");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      id: "ev-001",
      artifactId: "img-1",
      text: "IMAGE artifact supplied: shot.png"
    });
    expect(chunks[1]).toMatchObject({
      id: "ev-002",
      artifactId: "pdf-1",
      text: "PDF artifact supplied: report.pdf"
    });
  });

  it("issues stable, zero-padded sequential IDs starting at ev-001", () => {
    const artifacts: EvidenceArtifact[] = [
      {
        id: "f1",
        name: "a.txt",
        kind: "text",
        type: "text/plain",
        size: 10,
        content: "line one\nline two\nline three"
      }
    ];
    const chunks = buildEvidenceChunks(artifacts, "");
    expect(chunks.map((c) => c.id)).toEqual(["ev-001", "ev-002", "ev-003"]);
  });

  it("skips blank lines when chunking text content", () => {
    const artifacts: EvidenceArtifact[] = [
      {
        id: "f1",
        name: "a.txt",
        kind: "text",
        type: "text/plain",
        size: 10,
        content: "line one\n\nline two\n   \nline three"
      }
    ];
    const chunks = buildEvidenceChunks(artifacts, "");
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.text)).toEqual(["line one", "line two", "line three"]);
  });

  it("preserves source line numbers (1-indexed) on text chunks", () => {
    const artifacts: EvidenceArtifact[] = [
      {
        id: "f1",
        name: "a.txt",
        kind: "text",
        type: "text/plain",
        size: 10,
        content: "alpha\nbravo\ncharlie"
      }
    ];
    const chunks = buildEvidenceChunks(artifacts, "");
    expect(chunks.map((c) => [c.text, c.lineStart, c.lineEnd])).toEqual([
      ["alpha", 1, 1],
      ["bravo", 2, 2],
      ["charlie", 3, 3]
    ]);
  });

  it("for nmap content, emits structured 'Nmap:' chunks BEFORE raw-line chunks", () => {
    const nmap = `Nmap scan report for 10.10.10.5
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 7.2p2`;
    const artifacts: EvidenceArtifact[] = [
      { id: "nm", name: "nmap.txt", kind: "text", type: "text/plain", size: 100, content: nmap }
    ];
    const chunks = buildEvidenceChunks(artifacts, "");
    // First chunk(s) are structured "Nmap:" rows, then raw lines.
    expect(chunks[0].text.startsWith("Nmap:")).toBe(true);
    expect(chunks[0].text).toContain("10.10.10.5");
    expect(chunks[0].text).toContain("port 22/tcp open ssh");
    // After structured chunks, raw lines appear as their own chunks.
    expect(chunks.some((c) => c.text === "PORT     STATE SERVICE VERSION")).toBe(true);
  });

  it("caps total chunks at 180 to bound prompt size", () => {
    // 200 non-blank lines should be truncated to the 180 cap.
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");
    const artifacts: EvidenceArtifact[] = [
      { id: "f", name: "big.txt", kind: "text", type: "text/plain", size: lines.length, content: lines }
    ];
    expect(buildEvidenceChunks(artifacts, "")).toHaveLength(180);
  });
});
