import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AgentNotFoundError, RuntimeUnavailableError } from "@/core/shared/errors";
import { agentSystemContract } from "@/core/systems/agent-system.contract";
import { LiteLlmAgentSystem } from "./litellm-agent-system";

/** A fake LiteLLM proxy serving the endpoints the adapter uses, with data modelled on a real deployment. */

const MASTER_KEY = "sk-master-test";

const AGENTS = [
  {
    agent_id: "9c1e0a52-3f7b-4d2e-8a11-0b6f2c7d1a01",
    agent_name: "biology",
    agent_card_params: {
      name: "Biology Tutor",
      description: "Answers biology questions from the course notes and cites peer-reviewed sources.",
      url: "https://litellm.example.internal/a2a/biology",
      version: "1.2.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [
        { id: "sources", name: "Sources", description: "Finds and cites peer-reviewed sources", tags: ["research"] },
      ],
    },
    litellm_params: {
      model: "anthropic/claude-sonnet-4-5",
      api_key: "sk-ant-SECRET-biology",
      extra_headers: { "x-tenant": "tenant-secret" },
    },
    object_permission: { mcp_servers: ["sandbox"], mcp_access_groups: [], mcp_tool_permissions: null, agents: [] },
    enabled: true,
    execution_mode: "sync",
    created_at: "2026-10-02T09:14:00Z",
    updated_at: "2026-11-03T16:40:00Z",
  },
  {
    agent_id: "4e7b9d10-82a5-4c3f-9e60-1f2a3b4c5d6e",
    agent_name: "law",
    agent_card_params: {
      name: "EU Law Assistant",
      description: "Drafts and reviews documents against EU legislation.",
      url: "https://litellm.example.internal/a2a/law",
      version: "2.0.1",
      capabilities: { streaming: false },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [
        { id: "documents", name: "Documents", description: "Reads and edits Word documents" },
        { id: "eurlex", name: "EUR-Lex", description: "Searches EUR-Lex for consolidated acts" },
      ],
    },
    litellm_params: { model: "openai/gpt-4.1", api_key: "sk-proj-SECRET-law" },
    object_permission: {
      mcp_servers: ["sandbox", "office"],
      mcp_access_groups: [],
      mcp_tool_permissions: { office: ["read_word_document"] },
      agents: [],
    },
    enabled: true,
    execution_mode: "sync",
    created_at: "2026-09-18T11:02:00Z",
    updated_at: "2026-11-10T08:05:00Z",
  },
  {
    agent_id: "d2f81c3a-6b47-4e90-b1d5-7a8c9e0f1b23",
    agent_name: "reporter",
    agent_card_params: {
      name: "Newsroom Reporter",
      description: "Drafts news pieces, delegating research to specialists.",
      url: "https://litellm.example.internal/a2a/reporter",
      version: "0.9.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: [
        { id: "documents", name: "Documents", description: "Writes and formats articles" },
        { id: "sources", name: "Sources", description: "Finds and cites sources" },
      ],
    },
    litellm_params: { model: "anthropic/claude-sonnet-4-5", max_tokens: 4000 },
    object_permission: {
      mcp_servers: ["crm"],
      mcp_access_groups: ["newsroom"],
      mcp_tool_permissions: null,
      agents: ["biology", "law"],
    },
    enabled: true,
    execution_mode: "background",
    created_at: "2026-11-01T07:30:00Z",
    updated_at: "2026-11-14T12:00:00Z",
  },
];

const SERVERS = [
  {
    server_id: "3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
    server_name: "sandbox",
    alias: "sandbox",
    description: "Isolated Python execution",
    url: "http://sandbox-mcp:8000/mcp",
    transport: "http",
    instructions: null,
    allowed_tools: [],
    tool_name_to_description: {},
    mcp_access_groups: [],
    allow_all_keys: false,
    status: "healthy",
  },
  {
    server_id: "7b2d8e4f-1a3c-4d5e-8f6a-9b0c1d2e3f4a",
    server_name: "office",
    alias: "office",
    description: "Word document editing",
    url: "http://office-mcp:8001/mcp",
    transport: "http",
    instructions: null,
    allowed_tools: [],
    tool_name_to_description: {},
    mcp_access_groups: ["newsroom"],
    allow_all_keys: false,
    status: "healthy",
  },
  {
    server_id: "d41e9a0b-2c3d-4f5a-8b6c-7d8e9f0a1b2c",
    server_name: "crm",
    alias: "crm",
    description: "Contacts and story pipeline",
    url: "http://crm-mcp:9000/mcp",
    transport: "http",
    instructions: null,
    allowed_tools: [],
    tool_name_to_description: {},
    mcp_access_groups: [],
    allow_all_keys: false,
    status: "unhealthy",
  },
];

const TOOLS: Record<string, unknown> = {
  "3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b": {
    tools: [
      {
        name: "execute_python",
        description: "Run Python code in an isolated sandbox and return stdout",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python source to run" },
            restart: { type: "boolean", description: "Restart the interpreter first" },
          },
          required: ["code"],
        },
        mcp_info: { server_id: "3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b", alias: "sandbox", server_name: "sandbox" },
      },
    ],
    error: null,
    message: null,
  },
  "7b2d8e4f-1a3c-4d5e-8f6a-9b0c1d2e3f4a": {
    tools: [
      {
        name: "edit_word_document",
        description: "Apply tracked edits to a .docx file",
        inputSchema: { type: "object", properties: { path: { type: "string" }, edits: { type: "array" } }, required: ["path", "edits"] },
        mcp_info: { server_id: "7b2d8e4f-1a3c-4d5e-8f6a-9b0c1d2e3f4a", alias: "office", server_name: "office" },
      },
      {
        name: "read_word_document",
        description: "Return the text of a .docx file",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        mcp_info: { server_id: "7b2d8e4f-1a3c-4d5e-8f6a-9b0c1d2e3f4a", alias: "office", server_name: "office" },
      },
    ],
    error: null,
    message: null,
  },
  "d41e9a0b-2c3d-4f5a-8b6c-7d8e9f0a1b2c": {
    tools: [],
    error: "server_error",
    message: "crm-mcp:9000 refused the connection",
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function startFakeLiteLlm() {
  const authSeen: (string | null)[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      authSeen.push(auth);
      if (auth !== `Bearer ${MASTER_KEY}`) {
        return json({ detail: { error: "Authentication Error, invalid proxy server token" } }, 401);
      }
      if (url.pathname === "/v1/agents") return json(AGENTS);
      if (url.pathname.startsWith("/v1/agents/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/agents/".length));
        const agent = AGENTS.find((a) => a.agent_id === id || a.agent_name === id);
        return agent ? json(agent) : json({ detail: `Agent with id ${id} not found` }, 404);
      }
      if (url.pathname === "/v1/mcp/server") return json(SERVERS);
      if (url.pathname === "/mcp-rest/tools/list") {
        const serverId = url.searchParams.get("server_id") ?? "";
        const body = TOOLS[serverId];
        return body ? json(body) : json({ tools: [], error: "server_not_found", message: `No server ${serverId}` });
      }
      return json({ detail: "Not found" }, 404);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    authSeen,
    stop: () => server.stop(true),
  };
}

agentSystemContract("LiteLLM proxy", async () => {
  const fake = startFakeLiteLlm();
  return { system: new LiteLlmAgentSystem({ baseUrl: fake.url, apiKey: MASTER_KEY }), cleanup: () => fake.stop() };
});

describe("LiteLlmAgentSystem specifics", () => {
  let fake: ReturnType<typeof startFakeLiteLlm>;
  let system: LiteLlmAgentSystem;

  beforeAll(() => {
    fake = startFakeLiteLlm();
    system = new LiteLlmAgentSystem({ baseUrl: fake.url, apiKey: MASTER_KEY });
  });

  afterAll(() => fake.stop());

  test("info(): defaults to id litellm, kind litellm, read-only, labelled with the host", () => {
    const info = system.info();
    expect(info).toEqual({
      id: "litellm",
      label: `LiteLLM · 127.0.0.1:${new URL(fake.url).port}`,
      kind: "litellm",
      location: fake.url,
      editable: false,
    });
  });

  test("list(): ids are agent names, names and models come from the A2A card and litellm_params", async () => {
    const listing = await system.list();
    expect(listing.map((a) => a.id).sort()).toEqual(["biology", "law", "reporter"]);
    expect(listing.find((a) => a.id === "biology")).toMatchObject({
      name: "Biology Tutor",
      model: "anthropic/claude-sonnet-4-5",
      capabilityCount: 1,
      subAgentCount: 0,
    });
    expect(listing.find((a) => a.id === "reporter")).toMatchObject({ subAgentCount: 2 });
  });

  test("biology: sandbox tools granted with their input schema, skills and instructions fact", async () => {
    const agent = await system.describe("biology");
    expect(agent.instructions).toBeUndefined();
    expect(agent.facts).toContainEqual({ label: "Instructions", value: "not exposed by LiteLLM" });
    expect(agent.facts).toContainEqual({ label: "Execution mode", value: "sync" });
    expect(agent.facts).toContainEqual({ label: "Card version", value: "1.2.0" });
    expect(agent.skills).toEqual([{ id: "sources", description: "Finds and cites peer-reviewed sources" }]);

    expect(agent.capabilities.map((c) => c.capability.id)).toEqual(["sandbox"]);
    const [sandbox] = agent.capabilities;
    expect(sandbox.capability.runtime).toBe("litellm");
    expect(sandbox.tools.map((t) => [t.tool.name, t.access])).toEqual([["execute_python", "granted"]]);
    expect(sandbox.tools[0].tool.inputSchema).toMatchObject({ required: ["code"] });
    expect(sandbox.note).toBeUndefined();
  });

  test("law: tool permissions deny office edit_word_document, keep read_word_document granted", async () => {
    const agent = await system.describe("law");
    const office = agent.capabilities.find((c) => c.capability.id === "office");
    expect(office?.tools.map((t) => [t.tool.name, t.access])).toEqual([
      ["edit_word_document", "denied"],
      ["read_word_document", "granted"],
    ]);
    const sandbox = agent.capabilities.find((c) => c.capability.id === "sandbox");
    expect(sandbox?.tools.map((t) => t.access)).toEqual(["granted"]);
    expect(agent.skills?.map((s) => s.id)).toEqual(["documents", "eurlex"]);
  });

  test("reporter: office reachable through its access group, crm listing error becomes a note", async () => {
    const agent = await system.describe("reporter");
    const office = agent.capabilities.find((c) => c.capability.id === "office");
    expect(office?.tools.map((t) => t.access)).toEqual(["granted", "granted"]);

    const crm = agent.capabilities.find((c) => c.capability.id === "crm");
    expect(crm?.tools).toEqual([]);
    expect(crm?.note).toContain("server_error");
    expect(crm?.note).toContain("refused the connection");

    expect(agent.capabilities.find((c) => c.capability.id === "sandbox")).toBeUndefined();
  });

  test("sub-agents come from object_permission.agents and point at listed agents", async () => {
    const reporter = await system.describe("reporter");
    expect(reporter.subAgents).toEqual([
      { id: "biology", via: "A2A agent permission" },
      { id: "law", via: "A2A agent permission" },
    ]);
    expect((await system.describe("biology")).subAgents).toEqual([]);
  });

  test("native: a JSON copy of the agent with credentials removed and non-secret fields kept", async () => {
    const biology = await system.describe("biology");
    expect(biology.native?.format).toBe("litellm-agent.json");
    const text = biology.native?.text ?? "";
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("tenant-secret");
    expect(text).not.toContain("api_key");
    expect(text).not.toContain("extra_headers");
    const parsed = JSON.parse(text);
    expect(parsed.litellm_params).toEqual({ model: "anthropic/claude-sonnet-4-5" });
    expect(parsed.agent_card_params.name).toBe("Biology Tutor");

    const reporter = await system.describe("reporter");
    expect(reporter.native?.text).toContain('"max_tokens": 4000');
  });

  test("every request carries the bearer key", async () => {
    await system.list();
    expect(fake.authSeen.every((auth) => auth === `Bearer ${MASTER_KEY}`)).toBe(true);
  });

  test("a wrong key fails list() and describe() with RuntimeUnavailableError saying the key was rejected", async () => {
    const wrong = new LiteLlmAgentSystem({ baseUrl: fake.url, apiKey: "sk-wrong" });
    const failure = await wrong.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeUnavailableError);
    expect((failure as Error).message).toContain("401");
    expect((failure as Error).message).toContain("rejected the API key");

    await expect(wrong.describe("biology")).rejects.toBeInstanceOf(RuntimeUnavailableError);
  });

  test("no key configured is reported as a missing key, not a generic error", async () => {
    const anonymous = new LiteLlmAgentSystem({ baseUrl: fake.url });
    const failure = await anonymous.list().catch((error: unknown) => error);
    expect((failure as Error).message).toContain("requires an API key");
  });

  test("an unreachable proxy is reported as unreachable", async () => {
    const down = new LiteLlmAgentSystem({ baseUrl: "http://127.0.0.1:1", apiKey: MASTER_KEY, timeoutMs: 2000 });
    const failure = await down.list().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeUnavailableError);
    expect((failure as Error).message).toContain("unreachable");
  });

  test("describe() of an agent the proxy does not have throws AgentNotFoundError", async () => {
    await expect(system.describe("no-such-agent-xyz")).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});
