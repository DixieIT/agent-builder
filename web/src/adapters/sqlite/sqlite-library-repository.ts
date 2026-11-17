import type { ZodType } from "zod";
import { librarySchemas, type LibraryKind, type LibraryCapability, type Skill, type Tool } from "@/core/library/library";
import type { LibraryCollection, LibraryRecord, LibraryRepository } from "@/core/library/library-repository.port";
import { InvalidLibraryItemError, LibraryItemNotFoundError } from "@/core/shared/errors";
import type { SqliteDb } from "./sqlite-db";

interface ItemRow {
  name: string;
  data: string;
  created_at: string;
  updated_at: string;
}

/** One `library_items` collection (tools, skills or capabilities), validated with the core zod schema. */
class SqliteLibraryCollection<T extends { name: string }> implements LibraryCollection<T> {
  constructor(
    private readonly db: SqliteDb,
    private readonly kind: LibraryKind,
    private readonly schema: ZodType<T>,
  ) {}

  async list(): Promise<LibraryRecord<T>[]> {
    const rows = this.db.all<ItemRow>(
      "SELECT name, data, created_at, updated_at FROM library_items WHERE kind = ? ORDER BY name",
      this.kind,
    );
    return rows.map((row) => this.toRecord(row));
  }

  async get(name: string): Promise<LibraryRecord<T>> {
    const row = this.row(name);
    if (!row) throw new LibraryItemNotFoundError(this.kind, name);
    return this.toRecord(row);
  }

  async save(item: T): Promise<LibraryRecord<T>> {
    const parsed = this.schema.safeParse(item);
    if (!parsed.success) throw new InvalidLibraryItemError(this.kind, item.name, issueLines(parsed.error.issues));
    const { name } = parsed.data;
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO library_items (kind, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(kind, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      this.kind,
      name,
      JSON.stringify(parsed.data),
      now,
      now,
    );
    return this.get(name);
  }

  async remove(name: string): Promise<void> {
    const { changes } = this.db.run("DELETE FROM library_items WHERE kind = ? AND name = ?", this.kind, name);
    if (changes === 0) throw new LibraryItemNotFoundError(this.kind, name);
  }

  private row(name: string): ItemRow | undefined {
    return this.db.get<ItemRow>(
      "SELECT name, data, created_at, updated_at FROM library_items WHERE kind = ? AND name = ?",
      this.kind,
      name,
    );
  }

  /** Validates on read: a stored row that no longer matches the schema throws InvalidLibraryItemError. */
  private toRecord(row: ItemRow): LibraryRecord<T> {
    let raw: unknown;
    try {
      raw = JSON.parse(row.data);
    } catch (error) {
      throw new InvalidLibraryItemError(this.kind, row.name, [`(root): invalid JSON: ${messageOf(error)}`]);
    }
    const parsed = this.schema.safeParse(raw);
    if (!parsed.success) throw new InvalidLibraryItemError(this.kind, row.name, issueLines(parsed.error.issues));
    return {
      item: parsed.data,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

/** SQLite adapter for the library: one table, three collections keyed by kind and name. */
export class SqliteLibraryRepository implements LibraryRepository {
  readonly tools: LibraryCollection<Tool>;
  readonly skills: LibraryCollection<Skill>;
  readonly capabilities: LibraryCollection<LibraryCapability>;

  constructor(db: SqliteDb) {
    this.tools = new SqliteLibraryCollection<Tool>(db, "tool", librarySchemas.tool);
    this.skills = new SqliteLibraryCollection<Skill>(db, "skill", librarySchemas.skill);
    this.capabilities = new SqliteLibraryCollection<LibraryCapability>(db, "capability", librarySchemas.capability);
  }
}

function issueLines(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
