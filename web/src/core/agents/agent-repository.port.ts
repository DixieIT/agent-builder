import type { AgentId } from "./agent-id";
import type { AgentSpec } from "./agent-spec";

/** A stored agent: the canonical spec plus bookkeeping the store owns. */
export interface AgentRecord {
  id: AgentId;
  spec: AgentSpec;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentSummary {
  id: AgentId;
  name: string;
  description: string;
  model?: string;
  capabilityCount: number;
  updatedAt: Date;
  /** Set when the stored document cannot be read as an AgentSpec. */
  problem?: string;
}

/**
 * Port: persistence for agent specs. Adapters: filesystem (YAML), MongoDB.
 * Contract for every adapter:
 * - `get` throws AgentNotFoundError when missing, InvalidAgentDocumentError when the document fails `agentSpecSchema`.
 * - `create` throws AgentConflictError when the id exists.
 * - `save` upserts and keeps `createdAt` of an existing record.
 * - `remove` throws AgentNotFoundError when missing.
 * - `list` never throws for one bad document: it returns a summary with `problem` set.
 */
export interface AgentRepository {
  list(): Promise<AgentSummary[]>;
  get(id: AgentId): Promise<AgentRecord>;
  exists(id: AgentId): Promise<boolean>;
  create(id: AgentId, spec: AgentSpec): Promise<AgentRecord>;
  save(id: AgentId, spec: AgentSpec): Promise<AgentRecord>;
  remove(id: AgentId): Promise<void>;
}

/** Port for a store that needs provisioning (collections, validators, indexes). */
export interface ProvisionableStore {
  verify(): Promise<StoreCheck[]>;
  provision(): Promise<StoreCheck[]>;
}

export interface StoreCheck {
  name: string;
  ok: boolean;
  detail: string;
}
