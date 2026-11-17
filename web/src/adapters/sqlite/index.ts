import { SqliteAgentRepository } from "./sqlite-agent-repository";
import { SqliteEnvironmentStore } from "./sqlite-environment-store";
import { SqliteLibraryRepository } from "./sqlite-library-repository";
import { SqliteProjectRepository } from "./sqlite-project-repository";
import { SqliteSettingsStore } from "./sqlite-settings-store";
import { migrate, openSqlite } from "./sqlite-db";

export { SqliteProjectRepository } from "./sqlite-project-repository";
export { SqliteSettingsStore } from "./sqlite-settings-store";

/** Opens the built-in SQLite store at `file`, creating or migrating it. `secret` is UAB_SECRET_KEY. */
export function createSqliteStores(file: string, secret?: string) {
  const db = openSqlite(file);
  migrate(db);
  return {
    db,
    agents: new SqliteAgentRepository(db, file),
    projects: new SqliteProjectRepository(db, file),
    settings: new SqliteSettingsStore(db),
    library: new SqliteLibraryRepository(db),
    environment: new SqliteEnvironmentStore(db, file, secret),
  };
}

export type SqliteStores = ReturnType<typeof createSqliteStores>;
