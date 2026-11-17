import type { AgentSpec } from "@/core/agents/agent-spec";
import type { AgentExporter, ExportedAgent } from "@/core/runtime/agent-exporter.port";

import { formatLeleAgentFile, parseLeleAgentFile } from "./lele-agent-file";

const FALLBACK_NAME = "agent";

/** Exports a lele spec to AGENTS.md and reads one back. */
export class LeleExporter implements AgentExporter {
  readonly runtime = "lele";

  export(spec: AgentSpec): ExportedAgent {
    if (spec.runtime !== "lele") {
      throw new Error(`LeleExporter only exports lele specs; got "${spec.runtime}".`);
    }
    return {
      name: spec.name,
      definition: formatLeleAgentFile(spec),
      filename: "AGENTS.md",
      contentType: "text/markdown",
      warnings: [],
    };
  }

  parse(document: unknown): { spec: unknown; warnings: string[] } {
    if (typeof document !== "string") {
      throw new Error("A lele document must be the AGENTS.md text.");
    }
    // The front matter's `name` wins; without one the spec is called after the fallback folder name.
    return { spec: parseLeleAgentFile(document, FALLBACK_NAME), warnings: [] };
  }
}
