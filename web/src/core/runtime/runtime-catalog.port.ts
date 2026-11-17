import type { JsonSchemaObject } from "@/core/tools/tool-inspector.port";

/**
 * Port: what a harness offers to agents (tools, tool groups, skills), so the editor can list and grant them.
 * Adapter: lele (reads its tools.yaml, skill dirs, extensions and, when `lele serve` runs, its /health).
 */

export interface RuntimeTool {
  name: string;
  description?: string;
  /** JSON Schema of the arguments, when the harness exposes it. */
  parameters?: JsonSchemaObject;
}

export interface RuntimeToolGroup {
  /** The name an agent grants, e.g. "write-file", "subagent", an extension or plugin name. */
  name: string;
  description?: string;
  source: "builtin" | "plugin" | "extension" | "skill";
  /** Default state in the harness: always granted, active, available on demand, or off. */
  defaultState: "floor" | "active" | "available" | "disabled";
  tools: RuntimeTool[];
}

export interface RuntimeSkill {
  name: string;
  description: string;
  source: "package" | "global" | "project";
  path: string;
  /** Whether an agent can force-load it by granting it `active` (lele: package skills only). */
  grantable: boolean;
}

export interface RuntimeCatalog {
  runtime: string;
  toolGroups(): Promise<RuntimeToolGroup[]>;
  skills(): Promise<RuntimeSkill[]>;
  /** Facts the UI should state plainly, e.g. "tool argument schemas are not exposed by lele". */
  limitations(): string[];
}
