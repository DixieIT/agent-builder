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

export const SCHEMA_VERSION = 2;

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

/**
 * v2: projects. Agents are scoped to a project (their key becomes (project_id, id)); existing agents move to "default".
 * SQLite cannot change a primary key in place, so `agents` is rebuilt. Idempotent: skipped when project_id exists.
 */
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  systems TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const DEFAULT_PROJECT = "default";

/** Applies the v2 changes. Runs inside the caller's transaction. */
function migrateAgentsToProjects(db: SqliteDb): void {
  const columns = db.all<{ name: string }>("PRAGMA table_info(agents)");
  if (!columns.some((column) => column.name === "project_id")) {
    db.exec(`
DROP TABLE IF EXISTS agents_v2;
CREATE TABLE agents_v2 (
  project_id TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT}',
  id TEXT NOT NULL,
  spec TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
INSERT INTO agents_v2 (project_id, id, spec, created_at, updated_at)
  SELECT '${DEFAULT_PROJECT}', id, spec, created_at, updated_at FROM agents;
DROP TABLE agents;
ALTER TABLE agents_v2 RENAME TO agents;
`);
  }
}

/** Steps in order. A database at version N runs every step above N. */
const MIGRATIONS: { version: number; run: (db: SqliteDb) => void }[] = [
  { version: 1, run: (db) => db.exec(SCHEMA_V1) },
  {
    version: 2,
    run: (db) => {
      db.exec(SCHEMA_V2);
      migrateAgentsToProjects(db);
      db.run(
        "INSERT OR IGNORE INTO projects (id, name, description, systems, created_at, updated_at) VALUES (?, ?, '', '[]', ?, ?)",
        DEFAULT_PROJECT,
        "Default",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    },
  },
];

/** Creates or upgrades the tables and records the schema version. Safe to run on every start. */
export function migrate(db: SqliteDb): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const current = db.get<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version")?.version ?? 0;
  for (const step of MIGRATIONS) {
    if (step.version <= current) continue;
    try {
      db.exec("BEGIN");
      step.run(db);
      db.run("INSERT INTO schema_version (version) VALUES (?)", step.version);
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // No transaction open; the original error is the one to report.
      }
      throw error;
    }
  }
}
