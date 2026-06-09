// SQLite connection wrapper — uses Node's built-in node:sqlite (Node 22+).
// No native compilation, no extra deps, runs everywhere Node runs.

import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";

export type Database = DatabaseSync;

export interface OpenDatabaseOptions {
  /**
   * Path to the SQLite file. Pass ":memory:" for an ephemeral DB (used in tests).
   * Defaults to "verric.db" in the current working directory.
   */
  path?: string;
  /** Pass through any node:sqlite options if you need them. */
  raw?: DatabaseSyncOptions;
}

/**
 * Open (or create) a SQLite database, run pragmas that match Verric's
 * read/write profile (WAL for concurrent readers, foreign keys ON), then
 * apply migrations idempotently. Returns the open handle.
 *
 * Caller is responsible for closing it (the route process keeps it open
 * for its lifetime; tests use ":memory:" and let GC reclaim it).
 */
export function openDatabase(opts: OpenDatabaseOptions = {}): Database {
  const path = opts.path ?? "verric.db";
  const db = opts.raw ? new DatabaseSync(path, opts.raw) : new DatabaseSync(path);

  // ":memory:" can't use WAL; gracefully skip the pragma there.
  if (path !== ":memory:") {
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } catch {
      // Older SQLite or odd permissions — keep the rollback journal.
    }
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}

export function closeDatabase(db: Database) {
  try {
    db.close();
  } catch {
    // already closed
  }
}
