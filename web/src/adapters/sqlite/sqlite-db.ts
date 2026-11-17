import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Values bound to SQL parameters: the subset that both bun:sqlite and node:sqlite accept. */
export type SqlValue = string | number | null;

/** The small database surface the SQLite adapters use. Same shape on Bun and on Node. */
export interface SqliteDb {
  exec(sql: string): void;
  all<T>(sql: string, ...params: SqlValue[]): T[];
  get<T>(sql: string, ...params: SqlValue[]): T | undefined;
  run(sql: string, ...params: SqlValue[]): { changes: number };
  close(): void;
}

interface BunStatement {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { changes: number };
}
interface BunDatabase {
  exec(sql: string): void;
  query(sql: string): BunStatement;
  close(): void;
}
interface BunModule {
  Database: new (file: string, options: { create: boolean }) => BunDatabase;
}

interface NodeStatement {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { changes: number | bigint };
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}
interface NodeModule {
  DatabaseSync: new (file: string) => NodeDatabase;
}

/** Loaded at runtime so bundlers never try to resolve `bun:sqlite` or `node:sqlite` statically. */
const loadModule = createRequire(import.meta.url);

export const SCHEMA_VERSION = 1;

/** Opens (creating the directory and file if needed) the SQLite database at `file`. */
export function openSqlite(file: string): SqliteDb {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = typeof Bun !== "undefined" ? openBun(file) : openNode(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return db;
}

function openBun(file: string): SqliteDb {
  const { Database } = loadModule("bun:sqlite") as BunModule;
  const db = new Database(file, { create: true });
  return {
    exec: (sql) => db.exec(sql),
    all: <T>(sql: string, ...params: SqlValue[]) => db.query(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SqlValue[]) => (db.query(sql).get(...params) ?? undefined) as T | undefined,
    run: (sql, ...params) => ({ changes: db.query(sql).run(...params).changes }),
    close: () => db.close(),
  };
}

function openNode(file: string): SqliteDb {
  // process.getBuiltinModule is invisible to bundlers (Next/Turbopack can't resolve node:sqlite statically).
  const builtin = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const { DatabaseSync } = (builtin ? builtin("node:sqlite") : loadModule("node:sqlite")) as NodeModule;
  const db = new DatabaseSync(file);
  return {
    exec: (sql) => db.exec(sql),
    all: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SqlValue[]) => (db.prepare(sql).get(...params) ?? undefined) as T | undefined,
    run: (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    close: () => db.close(),
  };
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS library_items (
  kind TEXT NOT NULL CHECK(kind IN ('tool','skill','capability')),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY(kind,name)
);
CREATE TABLE IF NOT EXISTS env_vars (
  key TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  environments TEXT NOT NULL,
  sensitive INTEGER NOT NULL,
  comment TEXT,
  updated_at TEXT NOT NULL
);
`;

/** Creates the tables that are missing and records the schema version. Safe to run on every start. */
export function migrate(db: SqliteDb): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const current = db.get<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version")?.version ?? 0;
  if (current >= SCHEMA_VERSION) return;
  try {
    db.exec(`BEGIN;\n${SCHEMA_V1}\nINSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION});\nCOMMIT;`);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No transaction open; the original error is the one to report.
    }
    throw error;
  }
}
