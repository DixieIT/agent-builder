import { parseAgentId } from "@/core/agents/agent-id";
import type { AgentRepository } from "@/core/agents/agent-repository.port";
import { toCapability, type AgentSpec, type GooseAgentSpec, type LeleAgentSpec, type Runtime } from "@/core/agents/agent-spec";
import type { Capability } from "@/core/capabilities/capability";
import type { CapabilityCatalog } from "@/core/capabilities/capability-catalog.port";
import { capabilityAccess, LELE_AGENT_FLOOR, toolAccess, type Grants } from "@/core/capabilities/lele-access";
import type { AgentExporter } from "@/core/runtime/agent-exporter.port";
import type { AgentDescriptor, AgentListing, AgentSystemInfo, CapabilityView, SubAgentLink } from "@/core/systems/agent-system";
import type { AgentSystem } from "@/core/systems/agent-system.port";

/**
 * An AgentSystem over any AgentRepository holding builder specs (files, SQLite, Mongo, a lele project).
 * Goose agents: each capability is an extension; MCP servers are inspectable live, so their tools aren't listed here.
 * lele agents: each capability is a lele plugin read from lele's catalog, with per-tool access for this agent.
 */
export class RepositoryAgentSystem implements AgentSystem {
  constructor(
    private readonly about: AgentSystemInfo,
    private readonly repository: AgentRepository,
    private readonly exporterFor: (runtime: Runtime) => Promise<AgentExporter>,
    private readonly leleCatalog: () => Promise<CapabilityCatalog | undefined>,
    private readonly editPath?: (id: string) => string,
  ) {}

  info(): AgentSystemInfo {
    return this.about;
  }

  async list(): Promise<AgentListing[]> {
    const summaries = await this.repository.list();
    return Promise.all(
      summaries.map(async (summary): Promise<AgentListing> => {
        if (summary.problem) return { id: summary.id, name: summary.name, capabilityCount: 0, subAgentCount: 0, problem: summary.problem };
        try {
          const agent = await this.describe(summary.id);
          return {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            model: agent.model,
            capabilityCount: agent.capabilities.length,
            subAgentCount: agent.subAgents.length,
          };
        } catch (error) {
          return { id: summary.id, name: summary.name, capabilityCount: 0, subAgentCount: 0, problem: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
  }

  async describe(id: string): Promise<AgentDescriptor> {
    const { spec } = await this.repository.get(parseAgentId(id));
    const others = (await this.repository.list()).filter((a) => a.id !== id && !a.problem);
    const exported = await this.exporterFor(spec.runtime).then((e) => e.export(spec)).catch(() => undefined);
    const base = {
      id,
      name: spec.name,
      description: spec.description || undefined,
      model: spec.model,
      instructions: instructionsOf(spec),
      native: exported ? { format: exported.filename, text: exported.definition } : undefined,
      editPath: this.about.editable ? this.editPath?.(id) : undefined,
    };
    return spec.runtime === "goose"
      ? { ...base, ...describeGoose(spec, others.map((a) => a.id)) }
      : { ...base, ...(await this.describeLele(spec, others)) };
  }

  private async describeLele(spec: LeleAgentSpec, others: { id: string }[]): Promise<Pick<AgentDescriptor, "capabilities" | "subAgents" | "facts">> {
    const grants = spec.capabilities as Grants;
    const facts = [{ label: "Runtime", value: "lele" }];
    if (spec.hidden) facts.push({ label: "Hidden", value: "yes" });
    if (spec.simple) facts.push({ label: "Simple prompt", value: "yes" });

    const catalog = await this.leleCatalog().catch(() => undefined);
    const capabilities = catalog ? await catalog.capabilities().catch(() => undefined) : undefined;
    if (!catalog || !capabilities) {
      // lele isn't reachable: show the grants as written so nothing is hidden.
      const views: CapabilityView[] = Object.entries(grants).map(([name, grant]) => ({
        capability: { id: name, runtime: "lele", description: "", tools: [] },
        tools: [],
        note: `Granted "${grant}". lele isn't reachable, so its tools can't be listed.`,
      }));
      return { capabilities: views, subAgents: [], facts };
    }

    const floor = await catalog.grantFloor().catch(() => [...LELE_AGENT_FLOOR]);
    const views: CapabilityView[] = capabilities
      .filter((c) => capabilityAccess(c, grants, floor) !== "none")
      .map((c) => ({ capability: c, tools: c.tools.map((tool) => ({ tool, access: toolAccess(c, tool, grants, floor) })) }));

    // lele's subagent tool can delegate to any agent in the roster.
    const delegates = views.some((v) => v.tools.some((t) => t.tool.name === "subagent" && t.access !== "denied"));
    const subAgents: SubAgentLink[] = delegates ? others.map((a) => ({ id: a.id, via: "subagent tool" })) : [];
    return { capabilities: views, subAgents, facts };
  }
}

function describeGoose(spec: GooseAgentSpec, otherIds: string[]): Pick<AgentDescriptor, "capabilities" | "subAgents" | "facts"> {
  const capabilities: CapabilityView[] = spec.capabilities.map((entry) => {
    const capability = toCapability(entry);
    const allowed = capability.args.allowed_tools;
    if (capability.kind === "GooseExtension") {
      const cap: Capability = {
        id: capability.args.name,
        runtime: "goose",
        description: capability.args.description ?? `Goose ${capability.args.type} extension`,
        tools: (allowed ?? []).map((name) => ({ name, deferred: false, group: capability.args.name })),
      };
      return {
        capability: cap,
        tools: cap.tools.map((tool) => ({ tool, access: "granted" as const })),
        note: allowed?.length ? undefined : "Goose builtin: all of its tools, listed by Goose at run time.",
      };
    }
    const name = capability.args.id;
    const description = capability.args.description ?? (capability.kind === "MCP" ? capability.args.url : capability.args.command);
    return {
      capability: { id: name, runtime: "goose", description, tools: [] },
      tools: [],
      note: allowed?.length ? `MCP server limited to: ${allowed.join(", ")}. Inspect to see their arguments.` : "MCP server: inspect it to list its tools.",
      inspectable: { kind: capability.kind, args: capability.args },
    };
  });

  const ids = new Set(otherIds);
  const subAgents: SubAgentLink[] = (spec.sub_recipes ?? [])
    .map((sub) => ({ id: candidates(sub.name, sub.path).find((c) => ids.has(c)), via: "sub_recipe" }))
    .filter((link): link is SubAgentLink => link.id !== undefined);

  const facts = [{ label: "Runtime", value: "goose" }];
  if (spec.model_settings?.temperature !== undefined) facts.push({ label: "Temperature", value: String(spec.model_settings.temperature) });
  if (spec.max_turns) facts.push({ label: "Max turns", value: String(spec.max_turns) });
  if (spec.retry) facts.push({ label: "Retry", value: `${spec.retry.max_retries}× on ${spec.retry.checks.length} check(s)` });
  if (spec.deps_schema) facts.push({ label: "Inputs", value: Object.keys(spec.deps_schema.properties).join(", ") });
  if (spec.output_schema) facts.push({ label: "Output", value: "structured (JSON Schema)" });
  return { capabilities, subAgents, facts };
}

/** Sub-recipes reference recipes by name or path; try both as agent ids. */
function candidates(name: string, file: string): string[] {
  const base = file.split(/[\\/]/).pop()?.replace(/\.(ya?ml|json)$/i, "") ?? "";
  return [name, base, name.replace(/_/g, "-"), base.replace(/_/g, "-")].map((s) => s.toLowerCase()).filter(Boolean);
}

function instructionsOf(spec: AgentSpec): string | undefined {
  const text = Array.isArray(spec.instructions) ? spec.instructions.join("\n\n") : spec.instructions;
  return text?.trim() ? text : undefined;
}
