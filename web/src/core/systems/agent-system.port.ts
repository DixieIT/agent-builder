import type { AgentDescriptor, AgentListing, AgentSystemInfo } from "./agent-system";

/**
 * Port: one agentic system the UI can inspect. To support a new platform (e.g. a database where another
 * product defines its agents), write ONE adapter implementing this interface, make it pass
 * `agentSystemContract` (core/systems/agent-system.contract.ts), and register it in the container.
 * Nothing else changes: the explorer UI, the API and the CLI only see this port.
 */
export interface AgentSystem {
  info(): AgentSystemInfo;
  list(): Promise<AgentListing[]>;
  /** Throws AgentNotFoundError when the id doesn't exist. */
  describe(id: string): Promise<AgentDescriptor>;
}
