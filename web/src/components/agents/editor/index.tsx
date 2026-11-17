import type { AgentSpec } from "@/core/agents/agent-spec";
import type { Capability } from "@/core/capabilities/capability";
import type { RuntimeSkill } from "@/core/capabilities/capability-catalog.port";
import { GooseAgentEditor } from "./agent-editor";
import { LeleAgentEditor } from "./lele-agent-editor";

/** What the lele editor needs from the server: the harness's capabilities and skills, read from lele itself. */
export type LeleContext = {
  capabilities: Capability[];
  /** Grant names every agent has unless disabled, read from lele. */
  floor: string[];
  skills: RuntimeSkill[];
  limitations: string[];
  /** The AGENTS.md lele will read. */
  definition: string;
  /** Set when lele's capabilities couldn't be read (lele not installed, boot failed). */
  catalogError?: string;
};

/** Picks the editor for the agent's runtime. */
export function AgentEditor({ id, spec, updatedAt, lele }: { id: string; spec: AgentSpec; updatedAt: string; lele?: LeleContext }) {
  if (spec.runtime === "lele") {
    return <LeleAgentEditor id={id} initialSpec={spec} updatedAt={updatedAt} {...(lele ?? { capabilities: [], floor: [], skills: [], limitations: [], definition: "" })} />;
  }
  return <GooseAgentEditor id={id} initialSpec={spec} updatedAt={updatedAt} />;
}
