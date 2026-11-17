import type { Capability, CapabilityTool } from "@/core/capabilities/capability";
import { AgentNotFoundError, RuntimeUnavailableError } from "@/core/shared/errors";
import type { JsonSchemaObject } from "@/core/tools/tool-inspector.port";
import type { AgentDescriptor, AgentListing, AgentSystemInfo, CapabilityView, SubAgentLink } from "@/core/systems/agent-system";
import type { AgentSystem } from "@/core/systems/agent-system.port";

export interface LiteLlmAgentSystemOptions {
  /** Stable id in the explorer, default "litellm". */
  id?: string;
  /** Proxy root, e.g. "https://litellm.example.internal". */
  baseUrl: string;
  /** Key sent as `Authorization: Bearer <key>`. Lists are filtered to what this key can reach. */
  apiKey?: string;
  label?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const RUNTIME = "litellm";
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
/** Keys whose values are credentials or routing secrets; removed from the "view source" copy. */
const SECRET_KEY = /(^|[_-])(api[_-]?)?(key|token|secret|password)$|^(keys|static_headers|extra_headers)$/i;

interface AgentCardSkill {
  id: string;
  name?: string;
  description?: string;
}

interface AgentCard {
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: AgentCardSkill[];
}

interface ObjectPermission {
  mcp_servers?: string[];
  mcp_access_groups?: string[];
  mcp_tool_permissions?: Record<string, string[]>;
  mcp_toolsets?: string[];
  models?: string[];
  agents?: string[];
}

/** LiteLLM AgentResponse (GET /v1/agents). */
interface LiteLlmAgent {
  agent_id: string;
  agent_name: string;
  agent_card_params?: AgentCard | null;
  litellm_params?: Record<string, unknown> | null;
  object_permission?: ObjectPermission | null;
  enabled?: boolean;
  execution_mode?: string;
}

/** A row of GET /v1/mcp/server. */
interface McpServer {
  server_id: string;
  server_name?: string | null;
  alias?: string | null;
  description?: string | null;
  url?: string | null;
  allowed_tools?: string[] | null;
  mcp_access_groups?: string[] | null;
  allow_all_keys?: boolean | null;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** GET /mcp-rest/tools/list: HTTP 200 even on failure, so `error` decides. */
interface McpToolsResponse {
  tools?: McpTool[];
  error?: string | null;
  message?: string | null;
}

interface ToolListing {
  tools: McpTool[];
  error?: string;
}

interface Context {
  agents: LiteLlmAgent[];
  servers: McpServer[];
  serversError?: string;
  tools(server: McpServer): Promise<ToolListing>;
}

/** Non-2xx answer from the proxy. Kept distinct so describe() can map 404 to AgentNotFoundError. */
class LiteLlmHttpError extends RuntimeUnavailableError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * An AgentSystem over a LiteLLM proxy's agent registry (A2A agents), the MCP servers they may use and the
 * sub-agents they may call. Read-only: LiteLLM agents are edited in the proxy, not here.
 */
export class LiteLlmAgentSystem implements AgentSystem {
  private readonly id: string;
  private readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LiteLlmAgentSystemOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.id = options.id ?? "litellm";
    this.label = options.label ?? `LiteLLM · ${new URL(this.baseUrl).host}`;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? fetch;
  }

  info(): AgentSystemInfo {
    return { id: this.id, label: this.label, kind: "litellm", location: this.baseUrl, editable: false };
  }

  async list(): Promise<AgentListing[]> {
    const ctx = await this.context();
    return Promise.all(
      ctx.agents.map(async (raw): Promise<AgentListing> => {
        const agent = await this.toDescriptor(raw, ctx);
        return {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          model: agent.model,
          capabilityCount: agent.capabilities.length,
          subAgentCount: agent.subAgents.length,
        };
      }),
    );
  }

  async describe(id: string): Promise<AgentDescriptor> {
    const raw = await this.getAgent(id);
    return this.toDescriptor(raw, await this.context());
  }

  private async getAgent(id: string): Promise<LiteLlmAgent> {
    try {
      return await this.get<LiteLlmAgent>(`/v1/agents/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof LiteLlmHttpError && error.status === 404) throw new AgentNotFoundError(id);
      throw error;
    }
  }

  /** Agents, MCP servers and a per-call cache of tool listings, so a server is asked once per call. */
  private async context(): Promise<Context> {
    const agents = await this.get<LiteLlmAgent[]>("/v1/agents");
    const servers = await this.get<McpServer[]>("/v1/mcp/server").then(
      (rows) => ({ servers: rows, serversError: undefined }),
      (error: unknown) => ({ servers: [] as McpServer[], serversError: messageOf(error) }),
    );
    const cache = new Map<string, Promise<ToolListing>>();
    return {
      agents,
      ...servers,
      tools: (server) => {
        let listing = cache.get(server.server_id);
        if (!listing) {
          listing = this.listTools(server.server_id);
          cache.set(server.server_id, listing);
        }
        return listing;
      },
    };
  }

  private async listTools(serverId: string): Promise<ToolListing> {
    try {
      const body = await this.get<McpToolsResponse>(`/mcp-rest/tools/list?server_id=${encodeURIComponent(serverId)}`);
      const error = body.error ? (body.message ? `${body.error}: ${body.message}` : body.error) : undefined;
      return { tools: body.tools ?? [], error };
    } catch (error) {
      return { tools: [], error: messageOf(error) };
    }
  }

  private async toDescriptor(raw: LiteLlmAgent, ctx: Context): Promise<AgentDescriptor> {
    const card = raw.agent_card_params ?? undefined;
    const id = agentId(raw);
    const permission = raw.object_permission ?? {};
    const model = raw.litellm_params?.model;

    const facts: { label: string; value: string }[] = [];
    if (raw.execution_mode) facts.push({ label: "Execution mode", value: raw.execution_mode });
    facts.push({ label: "Enabled", value: raw.enabled === false ? "no" : "yes" });
    if (card?.version) facts.push({ label: "Card version", value: card.version });
    if (card?.url) facts.push({ label: "URL", value: card.url });
    facts.push({ label: "Instructions", value: "not exposed by LiteLLM" });

    return {
      id,
      name: card?.name || raw.agent_name,
      description: card?.description || undefined,
      model: typeof model === "string" ? model : undefined,
      instructions: undefined,
      capabilities: await this.capabilitiesOf(permission, ctx),
      subAgents: subAgentsOf(raw, permission, ctx),
      skills: (card?.skills ?? []).map((skill) => ({ id: skill.id, description: skill.description || skill.name || skill.id })),
      facts,
      native: { format: "litellm-agent.json", text: JSON.stringify(redact(raw), null, 2) },
    };
  }

  private async capabilitiesOf(permission: ObjectPermission, ctx: Context): Promise<CapabilityView[]> {
    const named = new Set(permission.mcp_servers ?? []);
    const groups = new Set(permission.mcp_access_groups ?? []);
    const reachable = ctx.servers.filter(
      (server) =>
        serverNames(server).some((name) => named.has(name)) ||
        (server.mcp_access_groups ?? []).some((group) => groups.has(group)) ||
        server.allow_all_keys === true,
    );
    const views = await Promise.all(reachable.map((server) => this.serverView(server, permission, ctx)));

    for (const name of named) {
      if (ctx.servers.some((server) => serverNames(server).includes(name))) continue;
      views.push({
        capability: { id: name, runtime: RUNTIME, description: "", tools: [] },
        tools: [],
        note: ctx.serversError ?? `No MCP server named "${name}" is visible to this key.`,
      });
    }
    return views;
  }

  private async serverView(server: McpServer, permission: ObjectPermission, ctx: Context): Promise<CapabilityView> {
    const id = server.alias || server.server_name || server.server_id;
    const listing = await ctx.tools(server);
    const allowed = server.allowed_tools?.length ? new Set(server.allowed_tools) : undefined;
    const permitted = serverNames(server)
      .map((name) => permission.mcp_tool_permissions?.[name])
      .find((list) => list !== undefined);
    const permittedSet = permitted ? new Set(permitted) : undefined;

    const tools: CapabilityView["tools"] = listing.tools.map((tool) => {
      const denied = (allowed && !allowed.has(tool.name)) || (permittedSet && !permittedSet.has(tool.name));
      const capabilityTool: CapabilityTool = {
        name: tool.name,
        description: tool.description || undefined,
        inputSchema: tool.inputSchema as JsonSchemaObject | undefined,
        deferred: false,
        group: id,
      };
      return { tool: capabilityTool, access: denied ? "denied" : "granted" };
    });

    const capability: Capability = {
      id,
      runtime: RUNTIME,
      description: server.description || server.url || `MCP server ${id}`,
      tools: tools.map((t) => t.tool),
    };
    return { capability, tools, note: listing.error };
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.send(path);
    return (await response.json()) as T;
  }

  private async send(path: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      // Called unbound: the global fetch rejects a different receiver in browsers.
      const fetchImpl = this.fetchImpl;
      response = await fetchImpl(`${this.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new RuntimeUnavailableError(`LiteLLM at ${this.baseUrl} is unreachable: ${messageOf(error)}`);
    }
    if (response.ok) return response;

    const body = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new LiteLlmHttpError(response.status, httpMessage(response.status, path, body, this.apiKey !== undefined));
  }
}

/** The name the explorer shows: the agent's name when it is a valid id, else its LiteLLM id. */
function agentId(raw: LiteLlmAgent): string {
  return AGENT_ID_PATTERN.test(raw.agent_name) ? raw.agent_name : raw.agent_id;
}

function serverNames(server: McpServer): string[] {
  return [server.server_id, server.server_name, server.alias].filter((name): name is string => Boolean(name));
}

function subAgentsOf(raw: LiteLlmAgent, permission: ObjectPermission, ctx: Context): SubAgentLink[] {
  const self = agentId(raw);
  const targetOf = new Map<string, string>();
  for (const agent of ctx.agents) {
    const mapped = agentId(agent);
    for (const key of [agent.agent_id, agent.agent_name, mapped]) targetOf.set(key, mapped);
  }
  const seen = new Set<string>();
  const links: SubAgentLink[] = [];
  for (const reference of permission.agents ?? []) {
    const target = targetOf.get(reference);
    if (!target || target === self || seen.has(target)) continue;
    seen.add(target);
    links.push({ id: target, via: "A2A agent permission" });
  }
  return links;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, nested]) => [key, redact(nested)]),
    );
  }
  return value;
}

function httpMessage(status: number, path: string, body: string, hasKey: boolean): string {
  const snippet = body ? `: ${body}` : "";
  if (status === 401) {
    return hasKey
      ? `LiteLLM rejected the API key (401) on ${path}${snippet}. Check the key configured for this system.`
      : `LiteLLM requires an API key (401) on ${path}${snippet}. No key is configured for this system.`;
  }
  if (status === 403) return `The API key lacks access to ${path} (403)${snippet}. Check its permissions in LiteLLM.`;
  return `LiteLLM answered ${status} on ${path}${snippet}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
