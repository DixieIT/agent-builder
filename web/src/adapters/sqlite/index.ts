import { SqliteAgentRepository } from "./sqlite-agent-repository";
import { SqliteEnvironmentStore } from "./sqlite-environment-store";
import { SqliteLibraryRepository } from "./sqlite-library-repository";
import { migrate, openSqlite } from "./sqlite-db";

/** Opens the built-in SQLite store at `file`, creating or migrating it. `secret` is UAB_SECRET_KEY. */
export function createSqliteStores(file: string, secret?: string) {
  const db = openSqlite(file);
  migrate(db);
  return {
    db,
    agents: new SqliteAgentRepository(db, file),
    library: new SqliteLibraryRepository(db),
    environment: new SqliteEnvironmentStore(db, file, secret),
  };
}

export type SqliteStores = ReturnType<typeof createSqliteStores>;
