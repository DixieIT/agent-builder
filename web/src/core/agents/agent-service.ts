import { parseAgentId, slugifyAgentId, type AgentId } from "./agent-id";
import type { AgentEventBus } from "./agent-events.port";
import type { AgentRecord, AgentRepository, AgentSummary } from "./agent-repository.port";
import { newAgentSpec, validateAgentSpec, type SpecIssue } from "./agent-spec";
import { AgentValidationError } from "@/core/shared/errors";

/**
 * Application service: every use case on agents. The REST API, server actions and the CLI call this,
 * never the adapters directly.
 */
export class AgentService {
  constructor(
    private readonly repository: AgentRepository,
    private readonly events: AgentEventBus,
  ) {}

  list(): Promise<AgentSummary[]> {
    return this.repository.list();
  }

  get(id: string): Promise<AgentRecord> {
    return this.repository.get(parseAgentId(id));
  }

  /** Creates an empty agent from a display name. */
  async create(displayName: string): Promise<AgentRecord> {
    const id = slugifyAgentId(displayName);
    const spec = { ...newAgentSpec(id.replace(/-/g, "_")), description: displayName.trim() };
    return this.created(await this.repository.create(id, spec));
  }

  /** Creates an agent from a full spec document. The id comes from `name` unless given. */
  async import(document: unknown, id?: string): Promise<{ record: AgentRecord; issues: SpecIssue[] }> {
    const { spec, issues } = validateAgentSpec(document);
    if (!spec) throw new AgentValidationError(issues);
    const agentId = id ? parseAgentId(id) : slugifyAgentId(spec.name);
    return { record: this.created(await this.repository.create(agentId, spec)), issues };
  }

  /** Replaces the spec. Schema errors throw; rule violations (e.g. undeclared template vars) come back as issues. */
  async save(id: string, document: unknown): Promise<{ record: AgentRecord; issues: SpecIssue[] }> {
    const agentId = parseAgentId(id);
    const { spec, issues } = validateAgentSpec(document);
    if (!spec) throw new AgentValidationError(issues);
    const record = await this.repository.save(agentId, spec);
    this.emit("agent.updated", agentId);
    return { record, issues };
  }

  async remove(id: string): Promise<void> {
    const agentId = parseAgentId(id);
    await this.repository.remove(agentId);
    this.emit("agent.deleted", agentId);
  }

  private created(record: AgentRecord): AgentRecord {
    this.emit("agent.created", record.id);
    return record;
  }

  private emit(type: "agent.created" | "agent.updated" | "agent.deleted", id: AgentId) {
    this.events.publish({ type, id, at: new Date().toISOString() });
  }
}
