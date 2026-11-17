import type { Runtime } from "@/core/agents/agent-spec";
import type { JsonSchemaObject } from "@/core/tools/tool-inspector.port";

/**
 * A capability is a unit an agent is granted as a whole: a named set of tools.
 *  - lele:  a plugin (`core.pdf`, `core.web.tool`); its name is the grant written in AGENTS.md `tools:`.
 *  - Goose: an extension (an MCP server, a builtin); the capability entries of a Goose spec configure them.
 * A tool is one callable function inside a capability; capabilities and tools are never the same thing.
 */
export interface Capability {
  /** The grant name: a lele plugin label, a Goose extension name. */
  id: string;
  /** The system it belongs to: a builder runtime (goose, lele) or any other kind (litellm, ...). */
  runtime: Runtime | (string & {});
  description: string;
  tools: CapabilityTool[];
}

export interface CapabilityTool {
  name: string;
  description?: string;
  /** JSON Schema of the arguments, as the model receives it. */
  inputSchema?: JsonSchemaObject;
  /** Not in the agent's tool list until loaded on demand (lele: `load_skill <group>`). */
  deferred: boolean;
  /**
   * Finer grant name inside the capability (lele "skill" group, e.g. `bash` for bash/bash_output/bash_kill).
   * Equal to the capability id when the capability has no finer groups.
   */
  group: string;
}
