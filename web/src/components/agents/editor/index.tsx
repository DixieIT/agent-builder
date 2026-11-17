import type { AgentSpec } from "@/core/agents/agent-spec";
import type { RuntimeSkill, RuntimeToolGroup } from "@/core/runtime/runtime-catalog.port";
import { GooseAgentEditor } from "./agent-editor";
import { LeleAgentEditor } from "./lele-agent-editor";

export type LeleContext = { toolGroups: RuntimeToolGroup[]; skills: RuntimeSkill[]; limitations: string[]; definition: string };

/** Picks the editor for the agent's runtime. */
export function AgentEditor({ id, spec, updatedAt, lele }: { id: string; spec: AgentSpec; updatedAt: string; lele?: LeleContext }) {
  if (spec.runtime === "lele") {
    return <LeleAgentEditor id={id} initialSpec={spec} updatedAt={updatedAt} {...(lele ?? { toolGroups: [], skills: [], limitations: [], definition: "" })} />;
  }
  return <GooseAgentEditor id={id} initialSpec={spec} updatedAt={updatedAt} />;
}
