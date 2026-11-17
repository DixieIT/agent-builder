import type { AgentRepository } from "@/core/agents/agent-repository.port";
import type { Project, ProjectInput } from "./project";

/**
 * Port: projects and their agents. Adapter: SQLite (the builder always keeps projects there).
 * Errors: get/update/remove of an unknown id throw ProjectNotFoundError; create with a taken id throws ProjectConflictError.
 */
export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  /** The id is derived from the name (slug), made unique. */
  create(input: ProjectInput): Promise<Project>;
  update(id: string, input: ProjectInput): Promise<Project>;
  /** Removes the project and its agents. */
  remove(id: string): Promise<void>;
  /** The project's own agent store (same contract as every AgentRepository). */
  agents(projectId: string): AgentRepository;
}

/** Port: settings saved by `bun run agents config set` (non-secret; secrets go to the environment store). */
export interface SettingsStore {
  all(): Record<string, string>;
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  unset(key: string): void;
}
