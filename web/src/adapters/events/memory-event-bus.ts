import type { AgentEvent, AgentEventBus } from "@/core/agents/agent-events.port";

/** Adapter: single-process event bus. Enough for one server; swap for a broker when scaling out. */
export class MemoryEventBus implements AgentEventBus {
  private readonly listeners = new Set<(event: AgentEvent) => void>();

  publish(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // one broken subscriber must not stop the others
      }
    }
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
