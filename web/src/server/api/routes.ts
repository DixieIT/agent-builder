import "server-only";

import path from "node:path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import type { AgentEvent } from "@/core/agents/agent-events.port";
import type { AgentRepository, ProvisionableStore } from "@/core/agents/agent-repository.port";
import { validateAgentSpec } from "@/core/agents/agent-spec";
import { toGooseRecipe, fromGooseRecipe } from "@/adapters/goose/goose-recipe";
import { defineRoute, json } from "@/server/http/route";
import { sseResponse, fromSubscription } from "@/server/sse";
import {
  agentEvents,
  agentPackager,
  agentRepository,
  agentRunner,
  agentService,
  storeKind,
  toolInspector,
} from "@/server/container";
import { toToolSource } from "@/server/tool-source";
import {
  agentRecordDto,
  agentSpecDto,
  agentSummaryDto,
  buildContextDto,
  buildRequestDto,
  gooseImportResultDto,
  inspectionResultDto,
  mcpServerRefDto,
  runRequestDto,
  runtimeStatusDto,
  saveResultDto,
  storeStatusDto,
  toRecordDto,
  toSummaryDto,
  validationReportDto,
} from "./dto";

/*
 * Every operation of the REST API v1, declared once. Paths are relative to /api/v1.
 * The route modules under src/app/api/v1 only re-export these handlers.
 */

const idParams = z.object({ id: z.string().meta({ description: "Agent id." }) });

const createAgentBody = z.union([
  z.object({ name: z.string().min(1).meta({ description: "Display name; the id is derived from it." }) }),
  z.object({
    spec: agentSpecDto,
    id: z.string().optional().meta({ description: "Explicit id; defaults to a slug of spec.name." }),
  }),
]);

const recipeQuery = z.object({
  format: z.enum(["yaml", "json"]).default("yaml").meta({ description: "yaml: the recipe as text. json: {yaml, warnings}." }),
});

// ---------------------------------------------------------------- agents

export const listAgents = defineRoute({
  method: "get",
  path: "/agents",
  operationId: "listAgents",
  summary: "List agents",
  tags: ["Agents"],
  responses: {
    200: { description: "Agent summaries.", schema: z.array(agentSummaryDto) },
  },
  handler: async () => {
    const service = await agentService();
    return json((await service.list()).map(toSummaryDto));
  },
});

export const createAgent = defineRoute({
  method: "post",
  path: "/agents",
  operationId: "createAgent",
  summary: "Create an agent",
  description: "Either `{name}` creates an empty agent, or `{spec, id?}` imports a full AgentSpec document.",
  tags: ["Agents"],
  body: createAgentBody,
  responses: {
    201: { description: "The created agent and spec issues (empty for `{name}`).", schema: saveResultDto },
  },
  handler: async ({ body }) => {
    const service = await agentService();
    if ("name" in body) {
      const record = await service.create(body.name);
      return json({ record: toRecordDto(record), issues: [] }, 201);
    }
    const { record, issues } = await service.import(body.spec, body.id);
    return json({ record: toRecordDto(record), issues }, 201);
  },
});

export const getAgent = defineRoute({
  method: "get",
  path: "/agents/{id}",
  operationId: "getAgent",
  summary: "Get an agent",
  tags: ["Agents"],
  params: idParams,
  responses: {
    200: { description: "The agent.", schema: agentRecordDto },
    404: { description: "No agent with this id." },
  },
  handler: async ({ params }) => {
    const service = await agentService();
    return json(toRecordDto(await service.get(params.id)));
  },
});

export const saveAgent = defineRoute({
  method: "put",
  path: "/agents/{id}",
  operationId: "saveAgent",
  summary: "Replace an agent's spec",
  description: "Rule violations (for example undeclared template variables) come back as `issues`; schema errors are rejected.",
  tags: ["Agents"],
  params: idParams,
  body: agentSpecDto,
  responses: {
    200: { description: "The saved agent and spec issues.", schema: saveResultDto },
  },
  handler: async ({ params, body }) => {
    const service = await agentService();
    const { record, issues } = await service.save(params.id, body);
    return json({ record: toRecordDto(record), issues });
  },
});

export const deleteAgent = defineRoute({
  method: "delete",
  path: "/agents/{id}",
  operationId: "deleteAgent",
  summary: "Delete an agent",
  tags: ["Agents"],
  params: idParams,
  responses: {
    204: { description: "Deleted." },
    404: { description: "No agent with this id." },
  },
  handler: async ({ params }) => {
    const service = await agentService();
    await service.remove(params.id);
    return new Response(null, { status: 204 });
  },
});

export const validateAgentSpecRoute = defineRoute({
  method: "post",
  path: "/agents/validate",
  operationId: "validateAgentSpec",
  summary: "Validate an agent spec",
  description: "Checks a spec without storing it. Invalid specs are reported in the body, never as a 4xx.",
  tags: ["Agents"],
  body: z.unknown(),
  responses: {
    200: { description: "Validation report.", schema: validationReportDto },
  },
  handler: async ({ body }) => {
    const { issues } = validateAgentSpec(body);
    return json({ valid: !issues.some((issue) => issue.severity === "error"), issues });
  },
});

// ---------------------------------------------------------------- goose

export const exportGooseRecipe = defineRoute({
  method: "get",
  path: "/agents/{id}/recipe",
  operationId: "exportGooseRecipe",
  summary: "Export an agent as a Goose recipe",
  description:
    "`format=yaml` (default) returns the recipe as application/yaml with an X-Goose-Warnings count header. `format=json` returns {yaml, warnings}.",
  tags: ["Goose"],
  params: idParams,
  query: recipeQuery,
  responses: {
    200: {
      description: "The Goose recipe as YAML (format=yaml). With format=json the response body is {yaml, warnings} instead.",
      contentType: "application/yaml",
      schema: z.string(),
    },
    404: { description: "No agent with this id." },
  },
  handler: async ({ params, query }) => {
    const service = await agentService();
    const record = await service.get(params.id);
    const { yaml, warnings } = toGooseRecipe(record.spec);
    if (query.format === "json") return json({ yaml, warnings });
    return new Response(yaml, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "X-Goose-Warnings": String(warnings.length),
      },
    });
  },
});

export const importGooseRecipe = defineRoute({
  method: "post",
  path: "/agents/import/goose",
  operationId: "importGooseRecipe",
  summary: "Import a Goose recipe",
  description: "Creates an agent from a Goose recipe YAML document. The id is derived from the spec name.",
  tags: ["Goose"],
  bodyContentType: "application/yaml",
  body: z.string(),
  responses: {
    201: { description: "The created agent and conversion warnings.", schema: gooseImportResultDto },
    422: { description: "The recipe does not map to a valid agent spec." },
  },
  handler: async ({ body }) => {
    const { spec, warnings } = fromGooseRecipe(parseRecipeYaml(body));
    const service = await agentService();
    const { record } = await service.import(spec);
    return json({ record: toRecordDto(record), warnings }, 201);
  },
});

/** A YAML syntax error is reported as a 400 like any other invalid request body. */
function parseRecipeYaml(text: string): unknown {
  try {
    const document: unknown = parseYaml(text);
    if (typeof document !== "object" || document === null) {
      throw new Error("Expected a mapping at the top level.");
    }
    return document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new z.ZodError([{ code: "custom", path: [], message: `The body is not a valid Goose recipe: ${message}`, input: text }]);
  }
}

// ---------------------------------------------------------------- runtime

export const runtimeStatus = defineRoute({
  method: "get",
  path: "/runtime",
  operationId: "getRuntimeStatus",
  summary: "Runtime status",
  description: "Whether the agent runner (Goose CLI) is available.",
  tags: ["Runtime"],
  responses: {
    200: { description: "Runner status.", schema: runtimeStatusDto },
  },
  handler: async () => {
    const runner = await agentRunner();
    return json(await runner.status());
  },
});

export const runAgent = defineRoute({
  method: "post",
  path: "/agents/{id}/runs",
  operationId: "runAgent",
  summary: "Run an agent",
  description:
    "Exports the agent as a Goose recipe and runs it. Streams run.* events as server-sent events; the run is stopped when the client disconnects.",
  tags: ["Runtime"],
  params: idParams,
  body: runRequestDto,
  responses: {
    200: {
      description: "Server-sent events: run.started, run.output, run.finished, run.failed.",
      contentType: "text/event-stream",
    },
    404: { description: "No agent with this id." },
    503: { description: "The runtime is unavailable." },
  },
  handler: async ({ params, body, request }) => {
    const service = await agentService();
    const record = await service.get(params.id);
    const { yaml } = toGooseRecipe(record.spec);
    const runner = await agentRunner();
    return sseResponse(
      (signal) => runner.run({ definition: yaml, params: body.params, prompt: body.prompt }, signal),
      request,
    );
  },
});

export const buildAgentImage = defineRoute({
  method: "post",
  path: "/agents/{id}/image",
  operationId: "buildAgentImage",
  summary: "Build a container image for an agent",
  description: "Runs `docker build` on the agent's build context. Streams build.* events as server-sent events.",
  tags: ["Runtime"],
  params: idParams,
  body: buildRequestDto,
  responses: {
    200: {
      description: "Server-sent events: build.started, build.output, build.finished, build.failed.",
      contentType: "text/event-stream",
    },
    404: { description: "No agent with this id." },
  },
  handler: async ({ params, body, request }) => {
    const service = await agentService();
    const record = await service.get(params.id);
    const { yaml } = toGooseRecipe(record.spec);
    const packager = await agentPackager();
    const pkg = { agentId: params.id, definition: yaml, tag: body.tag ?? `uab/${params.id}:latest` };
    return sseResponse((signal) => packager.build(pkg, signal), request);
  },
});

export const agentImageContext = defineRoute({
  method: "get",
  path: "/agents/{id}/image/context",
  operationId: "getAgentImageContext",
  summary: "Image build context",
  description: "The files `docker build` would receive for this agent, without building.",
  tags: ["Runtime"],
  params: idParams,
  responses: {
    200: { description: "Build context files.", schema: buildContextDto },
    404: { description: "No agent with this id." },
  },
  handler: async ({ params }) => {
    const service = await agentService();
    const record = await service.get(params.id);
    const { yaml } = toGooseRecipe(record.spec);
    const packager = await agentPackager();
    return json(packager.context({ agentId: params.id, definition: yaml, tag: `uab/${params.id}:latest` }));
  },
});

// ---------------------------------------------------------------- tools

export const inspectTool = defineRoute({
  method: "post",
  path: "/tools/inspect",
  operationId: "inspectTool",
  summary: "Inspect a tool server",
  description: "Connects to an MCP server (remote, or local over stdio) and lists the tools it exposes.",
  tags: ["Tools"],
  body: mcpServerRefDto,
  responses: {
    200: { description: "The tools, or the error that prevented connecting.", schema: inspectionResultDto },
  },
  handler: async ({ body }) => {
    return json(await toolInspector().inspect(toToolSource(body)));
  },
});

// ---------------------------------------------------------------- store

/** Mirrors the default in container.ts (AGENTS_DIR, else ../agents). */
function agentsDir(): string {
  return process.env.AGENTS_DIR ?? path.resolve(process.cwd(), "..", "agents");
}

function isProvisionable(store: AgentRepository): store is AgentRepository & ProvisionableStore {
  return typeof (store as Partial<ProvisionableStore>).verify === "function";
}

export const storeStatus = defineRoute({
  method: "get",
  path: "/store",
  operationId: "getStore",
  summary: "Store status",
  description: "The configured store and, for stores that need provisioning, the result of their checks.",
  tags: ["Store"],
  responses: {
    200: { description: "Store kind and checks.", schema: storeStatusDto },
  },
  handler: async () => {
    const repository = await agentRepository();
    const checks = isProvisionable(repository)
      ? await repository.verify()
      : [{ name: "filesystem", ok: true, detail: `Agents are YAML files in ${agentsDir()}` }];
    return json({ kind: storeKind(), checks });
  },
});

// ---------------------------------------------------------------- events

export const streamEvents = defineRoute({
  method: "get",
  path: "/events",
  operationId: "streamEvents",
  summary: "Agent change events",
  description: "Server-sent stream of agent.created, agent.updated and agent.deleted events.",
  tags: ["Events"],
  responses: {
    200: { description: "Server-sent events of type AgentEvent.", contentType: "text/event-stream" },
  },
  handler: async ({ request }) => {
    const bus = agentEvents();
    return sseResponse((signal) => fromSubscription<AgentEvent>((push) => bus.subscribe(push), signal), request);
  },
});
