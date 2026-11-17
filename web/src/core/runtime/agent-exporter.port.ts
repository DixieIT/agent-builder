import type { AgentSpec, Runtime } from "@/core/agents/agent-spec";

export interface ExportedAgent {
  /** Name the harness uses for the agent (Goose recipe title, lele agent folder). */
  name: string;
  /** Harness-native file contents (Goose recipe YAML, lele AGENTS.md). */
  definition: string;
  filename: string;
  contentType: string;
  /** Always empty for specs that validate; kept for imports of foreign formats. */
  warnings: string[];
}

/** Port: turn a spec into its harness's native definition. One adapter per runtime. */
export interface AgentExporter {
  readonly runtime: Runtime;
  export(spec: AgentSpec): ExportedAgent;
  /** Harness-native document -> spec document (validated by the caller). */
  parse(document: unknown): { spec: unknown; warnings: string[] };
}
