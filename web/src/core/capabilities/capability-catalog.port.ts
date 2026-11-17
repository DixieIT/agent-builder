import type { Capability } from "./capability";

export interface RuntimeSkill {
  name: string;
  description: string;
  source: "package" | "global" | "project";
  path: string;
  /** Whether an agent can force-load it by granting it `active` (lele: package skills only). */
  grantable: boolean;
}

/**
 * Port: what a harness offers to agents, read from the harness itself.
 * Adapter: lele (boots lele's kernel and reads its tool registry; scans its skill folders).
 */
export interface CapabilityCatalog {
  readonly runtime: string;
  /** Every capability the harness has mounted, with its tools, descriptions and argument schemas. */
  capabilities(): Promise<Capability[]>;
  /** Grant names every agent has unless it disables them (lele: bash, read-file, todo). */
  grantFloor(): Promise<string[]>;
  skills(): Promise<RuntimeSkill[]>;
  /** Facts the UI should state plainly. */
  limitations(): string[];
}
