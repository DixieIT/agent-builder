import { type AgentId, isAgentId } from "@/core/agents/agent-id";
import type {
  AgentRecord,
  AgentRepository,
  AgentSummary,
  ProvisionableStore,
  StoreCheck,
} from "@/core/agents/agent-repository.port";
import { type AgentSpec, agentSpecSchema, capabilityCount, type SpecIssue } from "@/core/agents/agent-spec";
import {
  AgentConflictError,
  AgentNotFoundError,
  AgentValidationError,
  InvalidAgentDocumentError,
} from "@/core/shared/errors";
import { migrate, SCHEMA_VERSION, type SqliteDb } from "./sqlite-db";

interface AgentRow {
  id: string;
  spec: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, spec, created_at, updated_at";

/** Agents as rows of the `agents` table; the spec is stored as JSON. Errors follow the AgentRepository contract. */
export class SqliteAgentRepository implements AgentRepository, ProvisionableStore {
  constructor(
    private readonly db: SqliteDb,
    private readonly file: string,
  ) {}

  async list(): Promise<AgentSummary[]> {
    const rows = this.db.all<AgentRow>(`SELECT ${COLUMNS} FROM agents ORDER BY updated_at DESC`);
    return rows.map(summarize);
  }

  async get(id: AgentId): Promise<AgentRecord> {
    const row = this.row(id);
    if (!row) throw new AgentNotFoundError(id);
    return toRecord(row);
  }

  async exists(id: AgentId): Promise<boolean> {
    return this.hasRow(id);
  }

  async create(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = validated(spec);
    if (this.hasRow(id)) throw new AgentConflictError(id);
    const now = new Date().toISOString();
    this.db.run(
      "INSERT INTO agents (id, spec, created_at, updated_at) VALUES (?, ?, ?, ?)",
      id,
      JSON.stringify(valid),
      now,
      now,
    );
    return { id, spec: valid, createdAt: new Date(now), updatedAt: new Date(now) };
  }

  async save(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = validated(spec);
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO agents (id, spec, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET spec = excluded.spec, updated_at = excluded.updated_at`,
      id,
      JSON.stringify(valid),
      now,
      now,
    );
    const row = this.row(id);
    if (!row) throw new AgentNotFoundError(id);
    return toRecord(row);
  }

  async remove(id: AgentId): Promise<void> {
    const { changes } = this.db.run("DELETE FROM agents WHERE id = ?", id);
    if (changes === 0) throw new AgentNotFoundError(id);
  }

  async verify(): Promise<StoreCheck[]> {
    return [this.checkDatabase(), this.checkDocuments()];
  }

  async provision(): Promise<StoreCheck[]> {
    migrate(this.db);
    return this.verify();
  }

  private row(id: string): AgentRow | undefined {
    return this.db.get<AgentRow>(`SELECT ${COLUMNS} FROM agents WHERE id = ?`, id);
  }

  private hasRow(id: string): boolean {
    return this.db.get<{ found: number }>("SELECT 1 AS found FROM agents WHERE id = ?", id) !== undefined;
  }

  private checkDatabase(): StoreCheck {
    try {
      const version = this.db.get<{ version: number }>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version")?.version ?? 0;
      const ok = version >= SCHEMA_VERSION;
      return {
        name: "database",
        ok,
        detail: `${this.file} · schema version ${version}${ok ? "" : `, expected ${SCHEMA_VERSION}; run provision`}`,
      };
    } catch (error) {
      return { name: "database", ok: false, detail: `${this.file} · ${messageOf(error)}` };
    }
  }

  private checkDocuments(): StoreCheck {
    try {
      const rows = this.db.all<AgentRow>(`SELECT ${COLUMNS} FROM agents`);
      const invalid = rows.filter((row) => parseStored(row.spec).spec === undefined).map((row) => row.id);
      const ok = invalid.length === 0;
      return {
        name: "documents",
        ok,
        detail: ok ? `${rows.length} agent(s), all valid` : `${rows.length} agent(s), ${invalid.length} invalid: ${invalid.join(", ")}`,
      };
    } catch (error) {
      return { name: "documents", ok: false, detail: messageOf(error) };
    }
  }
}

function validated(spec: AgentSpec): AgentSpec {
  const parsed = agentSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const issues: SpecIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
      severity: "error",
    }));
    throw new AgentValidationError(issues);
  }
  return parsed.data;
}

/** Parses a stored spec. Returns the issues instead of throwing so list() can report them. */
function parseStored(raw: string): { spec?: AgentSpec; issues: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { issues: [`(root): invalid JSON: ${messageOf(error)}`] };
  }
  const parsed = agentSpecSchema.safeParse(json);
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`) };
  }
  return { spec: parsed.data, issues: [] };
}

function toRecord(row: AgentRow): AgentRecord {
  const { spec, issues } = parseStored(row.spec);
  if (!spec) throw new InvalidAgentDocumentError(row.id, issues, row.spec);
  return {
    id: row.id as AgentId,
    spec,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function summarize(row: AgentRow): AgentSummary {
  const id = row.id as AgentId;
  const updatedAt = new Date(row.updated_at);
  const { spec, issues } = parseStored(row.spec);
  const problems = isAgentId(row.id) ? issues : [`invalid agent id "${row.id}"`, ...issues];
  if (!spec || problems.length > 0) {
    return { id, name: row.id, description: "", capabilityCount: 0, updatedAt, problem: problems.join("; ") || "unreadable spec" };
  }
  return {
    id,
    name: spec.name,
    description: spec.description,
    ...(spec.model ? { model: spec.model } : {}),
    capabilityCount: capabilityCount(spec),
    updatedAt,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
