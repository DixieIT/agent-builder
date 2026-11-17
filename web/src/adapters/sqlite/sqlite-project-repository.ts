import { z } from "zod";
import type { AgentRepository } from "@/core/agents/agent-repository.port";
import { DEFAULT_PROJECT_ID, projectIdSchema, projectInputSchema, systemSourceSchema, type Project, type ProjectInput } from "@/core/projects/project";
import type { ProjectRepository } from "@/core/projects/project-repository.port";
import { ProjectNotFoundError, ProjectProtectedError } from "@/core/shared/errors";
import { SqliteAgentRepository } from "./sqlite-agent-repository";
import type { SqliteDb } from "./sqlite-db";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  systems: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, name, description, systems, created_at, updated_at";
const systemsSchema = z.array(systemSourceSchema);

/** Projects as rows of the `projects` table; `systems` is stored as JSON. The default project cannot be removed. */
export class SqliteProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: SqliteDb,
    private readonly file: string,
  ) {}

  async list(): Promise<Project[]> {
    return this.db.all<ProjectRow>(`SELECT ${COLUMNS} FROM projects ORDER BY created_at, id`).map(toProject);
  }

  async get(id: string): Promise<Project> {
    return toProject(this.row(id));
  }

  async create(input: ProjectInput): Promise<Project> {
    const data = projectInputSchema.parse(input);
    const id = this.uniqueId(slugify(data.name));
    const now = new Date().toISOString();
    this.db.run(
      "INSERT INTO projects (id, name, description, systems, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      data.name,
      data.description,
      JSON.stringify(data.systems),
      now,
      now,
    );
    return this.get(id);
  }

  async update(id: string, input: ProjectInput): Promise<Project> {
    this.row(id);
    const data = projectInputSchema.parse(input);
    this.db.run(
      "UPDATE projects SET name = ?, description = ?, systems = ?, updated_at = ? WHERE id = ?",
      data.name,
      data.description,
      JSON.stringify(data.systems),
      new Date().toISOString(),
      id,
    );
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    if (id === DEFAULT_PROJECT_ID) throw new ProjectProtectedError(id);
    this.row(id);
    this.db.exec("BEGIN");
    try {
      this.db.run("DELETE FROM agents WHERE project_id = ?", id);
      this.db.run("DELETE FROM projects WHERE id = ?", id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Throws ProjectNotFoundError synchronously for an unknown project, as the port documents. */
  agents(projectId: string): AgentRepository {
    this.row(projectId);
    return new SqliteAgentRepository(this.db, this.file, projectId);
  }

  private row(id: string): ProjectRow {
    const row = this.db.get<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE id = ?`, id);
    if (!row) throw new ProjectNotFoundError(id);
    return row;
  }

  /** "name", then "name-2", "name-3"... among the ids already stored. */
  private uniqueId(base: string): string {
    let id = base;
    for (let n = 2; this.db.get("SELECT 1 AS found FROM projects WHERE id = ?", id) !== undefined; n++) id = `${base}-${n}`;
    return id;
  }
}

function toProject(row: ProjectRow): Project {
  const systems = systemsSchema.parse(JSON.parse(row.systems));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systems,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** A URL-safe id from a display name: lowercase ASCII words joined by "-". */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const id = slug || "project";
  return projectIdSchema.parse(id);
}
