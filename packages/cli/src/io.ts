// Filesystem helpers for the CLI: read evidence from a directory,
// load/save project + report + receipt JSON files. Stays small on
// purpose — sophistication lives in @verric/core.

import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  type EvidenceArtifact,
  emptyProjectDetails,
  inferEvidenceKind,
  type ProjectDetails
} from "@verric/core";

/** Files larger than this are skipped (they're almost certainly not pentest evidence). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Scan a directory for evidence. Skips dotfiles, anything over 5 MB, and
 * binary-looking files we can't ingest as text/notes.
 *
 * Returns artifacts in lexical order so chunk IDs are stable across runs
 * given the same directory contents — important for receipts.
 */
export async function readEvidenceDir(dirPath: string): Promise<EvidenceArtifact[]> {
  const abs = resolve(dirPath);
  let names: string[];
  try {
    names = await readdir(abs);
  } catch (err) {
    throw new Error(`Cannot read evidence directory ${abs}: ${(err as Error).message}`);
  }
  names.sort();
  const artifacts: EvidenceArtifact[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(abs, name);
    const st = await stat(full);
    if (!st.isFile()) continue;
    if (st.size > MAX_FILE_BYTES) continue;
    const kind = inferEvidenceKind(name, mimeFromExt(name));
    const id = `file-${artifacts.length + 1}`;
    if (kind === "text" || kind === "json" || kind === "xml" || kind === "notes") {
      const content = await readFile(full, "utf8");
      artifacts.push({
        id,
        name,
        kind,
        type: mimeFromExt(name) || "text/plain",
        size: st.size,
        content: content.slice(0, 160000)
      });
    } else if (kind === "image") {
      // We don't read image bytes here — that's a UI/PDF-export concern.
      // The chunk pipeline records "IMAGE artifact supplied: <name>".
      artifacts.push({
        id,
        name,
        kind,
        type: mimeFromExt(name) || "image/unknown",
        size: st.size,
        content: `Image artifact supplied: ${name}`
      });
    } else if (kind === "pdf") {
      artifacts.push({
        id,
        name,
        kind,
        type: "application/pdf",
        size: st.size,
        content: `PDF artifact supplied: ${name}`
      });
    } else {
      // unknown — ingest as text best-effort
      try {
        const content = await readFile(full, "utf8");
        artifacts.push({
          id,
          name,
          kind: "text",
          type: "text/plain",
          size: st.size,
          content: content.slice(0, 160000)
        });
      } catch {
        // skip binary
      }
    }
  }
  return artifacts;
}

function mimeFromExt(name: string): string {
  const ext = extname(name).toLowerCase();
  switch (ext) {
    case ".txt":
      return "text/plain";
    case ".log":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".xml":
      return "application/xml";
    case ".html":
      return "text/html";
    case ".http":
      return "message/http";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    default:
      return "";
  }
}

/**
 * Read a ProjectDetails JSON file. If the file is missing, returns the
 * built-in emptyProjectDetails — handy for one-shot dev runs.
 */
export async function readProjectFile(path?: string): Promise<ProjectDetails> {
  if (!path) return emptyProjectDetails;
  try {
    const txt = await readFile(path, "utf8");
    const parsed = JSON.parse(txt) as Partial<ProjectDetails>;
    return { ...emptyProjectDetails, ...parsed };
  } catch (err) {
    throw new Error(`Cannot read project file ${path}: ${(err as Error).message}`);
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const txt = await readFile(path, "utf8");
  return JSON.parse(txt) as T;
}
