// Server-side singleton SQLite connection.
//
// The Next.js dev server hot-reloads modules, which would normally open a
// fresh DB handle on every reload and pile up file locks. We stash the
// handle on globalThis so dev-time HMR reuses the same connection.

import { migrate, openDatabase, type Database } from "@verric/storage";

declare global {
  var __verricDb: Database | undefined;
}

/**
 * Lazily open the DB and apply migrations. Call this from each route
 * handler that needs storage. Idempotent.
 *
 * We stash the handle on globalThis BEFORE running migrate so that, in
 * the case of a transient migration failure, the next request reuses
 * the same connection rather than racing to reopen the file (which
 * leaves stray WAL sidecars).
 */
export function getDb(): Database {
  if (globalThis.__verricDb) return globalThis.__verricDb;
  const path = process.env.VERRIC_DB_PATH || "verric.db";
  const db = openDatabase({ path });
  globalThis.__verricDb = db;
  migrate(db);
  return db;
}
