import type { SettingsStore } from "@/core/projects/project-repository.port";
import type { SqliteDb } from "./sqlite-db";

interface SettingRow {
  key: string;
  value: string;
}

/** Settings as rows of the `settings` table. Synchronous, like the database handle it wraps. */
export class SqliteSettingsStore implements SettingsStore {
  constructor(private readonly db: SqliteDb) {}

  all(): Record<string, string> {
    const rows = this.db.all<SettingRow>("SELECT key, value FROM settings ORDER BY key");
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  get(key: string): string | undefined {
    return this.db.get<SettingRow>("SELECT key, value FROM settings WHERE key = ?", key)?.value;
  }

  set(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString(),
    );
  }

  unset(key: string): void {
    this.db.run("DELETE FROM settings WHERE key = ?", key);
  }
}
