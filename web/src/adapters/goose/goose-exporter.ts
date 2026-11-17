import type { AgentSpec } from "@/core/agents/agent-spec";
import type { AgentExporter, ExportedAgent } from "@/core/runtime/agent-exporter.port";
import { fromGooseRecipe, toGooseRecipe } from "./goose-recipe";

/** Adapter: AgentSpec -> Goose recipe YAML. */
export class GooseExporter implements AgentExporter {
  readonly runtime = "goose" as const;

  export(spec: AgentSpec): ExportedAgent {
    if (spec.runtime !== "goose") throw new Error(`GooseExporter can't export a ${spec.runtime} agent.`);
    const { yaml, warnings } = toGooseRecipe(spec);
    return { name: spec.name, definition: yaml, filename: "recipe.yaml", contentType: "application/yaml", warnings };
  }

  parse(document: unknown) {
    return fromGooseRecipe(document);
  }
}
