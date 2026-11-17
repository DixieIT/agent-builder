import type { Environment, EnvVar, EnvVarInput } from "./environment";

/**
 * Port: where environment variables live. Adapters:
 *  - dotenv folder   a directory with `.env.development`, `.env.preview`, `.env.production` (+ shared `.env`)
 *  - sqlite          the builder's own store, values encrypted at rest with UAB_SECRET_KEY
 * The container picks the source from ENV_SOURCE (+ ENV_DIR for the folder source).
 */
export interface EnvironmentStore {
  /** Human description of the source, e.g. "Folder D:\\proj\\env" or "Built-in store". */
  describe(): EnvSourceInfo;
  list(): Promise<EnvVar[]>;
  /** Creates or replaces a variable. */
  set(input: EnvVarInput): Promise<EnvVar>;
  remove(key: string): Promise<void>;
  /** Plain values for a run or build. `missing` lists keys with no value in that environment. */
  resolve(environment: Environment, keys: string[]): Promise<{ values: Record<string, string>; missing: string[] }>;
}

export interface EnvSourceInfo {
  kind: "folder" | "sqlite";
  label: string;
  /** Folder path or database file. */
  location: string;
  writable: boolean;
}
