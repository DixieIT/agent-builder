import type { AgentId } from "./agent-id";

export type AgentEvent = {
  type: "agent.created" | "agent.updated" | "agent.deleted";
  id: AgentId;
  at: string;
};

/** Port: fan-out of agent changes (UI live refresh, SSE clients). Adapter: in-memory bus; later Mongo change streams. */
export interface AgentEventBus {
  publish(event: AgentEvent): void;
  subscribe(listener: (event: AgentEvent) => void): () => void;
}
