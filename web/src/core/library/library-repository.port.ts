import type { LibraryCapability, Skill, Tool } from "./library";

export interface LibraryRecord<T> {
  item: T;
  createdAt: Date;
  updatedAt: Date;
}

/** Port: one collection of library items keyed by `name`. Same error contract as AgentRepository. */
export interface LibraryCollection<T extends { name: string }> {
  list(): Promise<LibraryRecord<T>[]>;
  get(name: string): Promise<LibraryRecord<T>>;
  /** Creates or replaces (import semantics). */
  save(item: T): Promise<LibraryRecord<T>>;
  remove(name: string): Promise<void>;
}

/** Port: the whole library. Adapter: SQLite. */
export interface LibraryRepository {
  tools: LibraryCollection<Tool>;
  skills: LibraryCollection<Skill>;
  capabilities: LibraryCollection<LibraryCapability>;
}
