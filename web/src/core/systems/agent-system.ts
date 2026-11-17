import type { Capability, CapabilityTool } from "@/core/capabilities/capability";
import type { ToolAccess } from "@/core/capabilities/lele-access";

/**
 * Read model for ANY agentic or multi-agent system (the builder's own store, lele, Goose recipes, a database
 * another platform keeps its agents in...). It is what the UI inspects; it never depends on one runtime's spec.
 */

export interface AgentSystemInfo {
  /** Stable id used in URLs, e.g. "builder", "lele", "deepgen". */
  id: string;
  label: string;
  /** Adapter kind, e.g. "builder-store", "lele", "postgres". */
  kind: string;
  /** Where the agents live: a folder, a database, a URL. */
  location: string;
  /** Whether the builder can edit these agents (an editor exists for their spec). */
  editable: boolean;
}

export interface AgentListing {
  id: string;
  name: string;
  description?: string;
  model?: string;
  capabilityCount: number;
  subAgentCount: number;
  /** Set when the agent couldn't be read. */
  problem?: string;
}

export interface AgentDescriptor {
  id: string;
  name: string;
  description?: string;
  model?: string;
  /** System prompt / instructions as the system stores them. */
  instructions?: string;
  capabilities: CapabilityView[];
  /** Knowledge the agent can load (SKILL.md documents, A2A card skills, playbooks...). Not tools. */
  skills?: { id: string; description: string }[];
  /** Agents this one can delegate to, by id in the same system (the multi-agent graph edges). */
  subAgents: SubAgentLink[];
  /** System-specific facts worth showing (runtime, profile, temperature, hidden...). */
  facts: { label: string; value: string }[];
  /** The agent as the system stores it, for "view source". */
  native?: { format: string; text: string };
  /** Builder editor URL path when the agent is editable here. */
  editPath?: string;
}

export interface CapabilityView {
  capability: Capability;
  /** Per tool: whether this agent can call it. Unknown when the system can't tell without running the tool server. */
  tools: { tool: CapabilityTool; access: ToolAccess | "unknown" }[];
  /** e.g. "MCP server, inspect to list its tools" when tools aren't known yet. */
  note?: string;
  /** Present when the capability's tools can be listed live (an MCP server): what the inspector needs. */
  inspectable?: unknown;
}

export interface SubAgentLink {
  id: string;
  /** How the delegation is declared, e.g. "subagent tool", "sub_recipe". */
  via: string;
}
