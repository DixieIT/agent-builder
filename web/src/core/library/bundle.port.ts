import type { AgentSpec, Runtime } from "@/core/agents/agent-spec";
import type { LibraryItem } from "./library";

/**
 * Port: a folder representation of agents and library items, with real code files.
 *
 *   <dir>/agents/<id>/agent.yaml
 *   <dir>/capabilities/<name>.yaml
 *   <dir>/tools/<name>/tool.yaml        (name, description, instructions, input_schema, deferred, language, dependencies, env_keys)
 *   <dir>/tools/<name>/main.py|main.ts|main.sh   (the code)
 *   <dir>/skills/<name>/SKILL.md        (frontmatter: name, description) + supporting files
 *
 * Every item folder/file can be imported on its own, and so can any folder of items (e.g. an `agents/` folder,
 * a lele `.lele/agents` folder, or a folder of Goose recipes).
 */
export interface BundleContent {
  agents: { id: string; spec: AgentSpec }[];
  items: LibraryItem[];
  /**
   * Agents found in a harness's own format (lele AGENTS.md, Goose recipe). The codec doesn't parse them:
   * the caller converts each with that runtime's AgentExporter.parse, keeping adapters independent.
   */
  native?: { path: string; runtime: Runtime; name: string; document: unknown }[];
  /** Files that were skipped, one line each ("path: reason"). Reading never fails because of one bad file. */
  problems?: string[];
}

export interface BundleCodec {
  /** Writes everything under `dir`; returns the paths written. */
  dump(dir: string, content: BundleContent): Promise<string[]>;
  /** Reads one item from a path (a tool/skill folder, a capability or agent YAML) or every item under a dump root. */
  read(path: string): Promise<BundleContent>;
}
