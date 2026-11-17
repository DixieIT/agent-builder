import "server-only";

import path from "node:path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import type { AgentEvent } from "@/core/agents/agent-events.port";
import type { AgentRepository, ProvisionableStore } from "@/core/agents/agent-repository.port";
import { RUNTIMES, validateAgentSpec } from "@/core/agents/agent-spec";
import { envKeySchema } from "@/core/environment/environment";
import { librarySchemas, type LibraryCapability, type LibraryKind, type Skill, type Tool } from "@/core/library/library";
import type { LibraryCollection, LibraryRepository } from "@/core/library/library-repository.port";
import { defineRoute, json } from "@/server/http/route";
import { sseResponse, fromSubscription } from "@/server/sse";
import {
  agentEvents,
  agentRepository,
  agentExporter,
  agentRunner,
  agentSystem,
  agentSystems,
  bundleCodec,
  importService,
  runService,
  agentService,
  environmentStore,
  libraryRepository,
  projectImportService,
  projectOwnSystem,
  projectRepository,
  capabilityCatalog,
  storeKind,
  toolInspector,
} from "@/server/container";
import { toToolSource } from "@/server/tool-source";
import { uploadedFolderSchema, withUploadedFolder } from "@/server/uploaded-folder";
import {
  agentDescriptorDto,
  agentListingDto,
  agentRecordDto,
  agentSpecDto,
  agentSystemInfoDto,
  agentSummaryDto,
  buildContextDto,
  buildRequestDto,
  environmentListingDto,
  envVarDto,
  envVarInputDto,
  gooseImportResultDto,
  inspectionResultDto,
  libraryRecordDto,
  mcpServerRefDto,
  projectDto,
  projectInputDto,
  toProjectDto,
  resolveEnvironmentRequestDto,
  resolveEnvironmentResultDto,
  runRequestDto,
  runtimeCapabilitiesDto,
  runtimeStatusDto,
  saveResultDto,
  storeStatusDto,
  toEnvVarDto,
  toLibraryRecordDto,
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
    const exported = await (await runService()).export(params.id);
    if (query.format === "json") return json({ yaml: exported.definition, warnings: exported.warnings });
    return new Response(exported.definition, {
      headers: {
        "Content-Type": `${exported.contentType}; charset=utf-8`,
        "Content-Disposition": `inline; filename="${exported.filename}"`,
        "X-Export-Warnings": String(exported.warnings.length),
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
    const { spec, warnings } = agentExporter("goose").parse(parseRecipeYaml(body));
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
  query: z.object({ runtime: z.enum(RUNTIMES).default("goose") }),
  handler: async ({ query }) => {
    const runner = await agentRunner(query.runtime);
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
    const runs = await runService();
    return sseResponse(
      (signal) => runs.run(params.id, { params: body.params, prompt: body.prompt, environment: body.environment }, signal),
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
    const runs = await runService();
    return sseResponse((signal) => runs.build(params.id, body.tag, signal), request);
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
    return json(await (await runService()).buildContext(params.id));
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

// ---------------------------------------------------------------- environment

const envNameParams = z.object({ key: envKeySchema.meta({ description: "Variable name, UPPER_SNAKE_CASE." }) });

export const listEnvironment = defineRoute({
  method: "get",
  path: "/environment",
  operationId: "listEnvironment",
  summary: "List environment variables",
  description: "The variables with masked values for sensitive entries, and the source they are stored in.",
  tags: ["Environment"],
  responses: {
    200: { description: "Source and variables.", schema: environmentListingDto },
  },
  handler: async () => {
    const store = await environmentStore();
    return json({ source: store.describe(), variables: (await store.list()).map(toEnvVarDto) });
  },
});

export const setEnvironmentVariable = defineRoute({
  method: "put",
  path: "/environment/{key}",
  operationId: "setEnvironmentVariable",
  summary: "Create or replace an environment variable",
  description: "The key comes from the path. Sensitive values are write-only: listings return them masked.",
  tags: ["Environment"],
  params: envNameParams,
  body: envVarInputDto,
  responses: {
    200: { description: "The saved variable.", schema: envVarDto },
  },
  handler: async ({ params, body }) => {
    const store = await environmentStore();
    return json(toEnvVarDto(await store.set({ ...body, key: params.key })));
  },
});

export const deleteEnvironmentVariable = defineRoute({
  method: "delete",
  path: "/environment/{key}",
  operationId: "deleteEnvironmentVariable",
  summary: "Delete an environment variable",
  tags: ["Environment"],
  params: envNameParams,
  responses: {
    204: { description: "Deleted." },
  },
  handler: async ({ params }) => {
    await (await environmentStore()).remove(params.key);
    return new Response(null, { status: 204 });
  },
});

export const resolveEnvironment = defineRoute({
  method: "post",
  path: "/environment/resolve",
  operationId: "resolveEnvironment",
  summary: "Resolve environment values",
  description:
    "Plain values of the given keys for one environment, as a run or build receives them. Returns secrets in plaintext, so it requires the `environment:read` scope.",
  tags: ["Environment"],
  scopes: ["environment:read"],
  body: resolveEnvironmentRequestDto,
  responses: {
    200: { description: "Values found, and the keys that have no value in that environment.", schema: resolveEnvironmentResultDto },
  },
  handler: async ({ body }) => {
    const store = await environmentStore();
    return json(await store.resolve(body.environment, body.keys));
  },
});

// ---------------------------------------------------------------- library

const LIBRARY_ROUTE_KINDS = ["tools", "skills", "capabilities"] as const;
const SINGULAR_KIND: Record<(typeof LIBRARY_ROUTE_KINDS)[number], LibraryKind> = {
  tools: "tool",
  skills: "skill",
  capabilities: "capability",
};
type AnyLibraryItem = Tool | Skill | LibraryCapability;

const libraryKindParams = z.object({
  kind: z.enum(LIBRARY_ROUTE_KINDS).meta({ description: "The library collection: tools, skills or capabilities." }),
});
const libraryItemParams = libraryKindParams.extend({
  name: z.string().min(1).meta({ description: "Item name (lowercase slug)." }),
});

function libraryCollection(repository: LibraryRepository, kind: LibraryKind): LibraryCollection<AnyLibraryItem> {
  const collections = { tool: repository.tools, skill: repository.skills, capability: repository.capabilities };
  return collections[kind];
}

/** Validates a library body against the schema of its kind; its name must be the one in the path (400 otherwise). */
function parseLibraryItem(kind: LibraryKind, name: string, body: unknown): AnyLibraryItem {
  const item: AnyLibraryItem = librarySchemas[kind].parse(body);
  if (item.name !== name) {
    throw new z.ZodError([
      { code: "custom", path: ["name"], message: `The name "${item.name}" must match the path name "${name}".`, input: body },
    ]);
  }
  return item;
}

export const listLibraryItems = defineRoute({
  method: "get",
  path: "/library/{kind}",
  operationId: "listLibraryItems",
  summary: "List library items",
  description: "Every item of one library collection, with its timestamps.",
  tags: ["Library"],
  params: libraryKindParams,
  responses: {
    200: { description: "Records of the collection.", schema: z.array(libraryRecordDto) },
  },
  handler: async ({ params }) => {
    const records = await libraryCollection(await libraryRepository(), SINGULAR_KIND[params.kind]).list();
    return json(records.map(toLibraryRecordDto));
  },
});

export const getLibraryItem = defineRoute({
  method: "get",
  path: "/library/{kind}/{name}",
  operationId: "getLibraryItem",
  summary: "Get a library item",
  tags: ["Library"],
  params: libraryItemParams,
  responses: {
    200: { description: "The item and its timestamps.", schema: libraryRecordDto },
    404: { description: "No item with this name in the collection." },
  },
  handler: async ({ params }) => {
    const record = await libraryCollection(await libraryRepository(), SINGULAR_KIND[params.kind]).get(params.name);
    return json(toLibraryRecordDto(record));
  },
});

export const saveLibraryItem = defineRoute({
  method: "put",
  path: "/library/{kind}/{name}",
  operationId: "saveLibraryItem",
  summary: "Create or replace a library item",
  description:
    "The body is the item itself, validated against the schema of its kind (tool, skill or capability). Its `name` must equal the path name.",
  tags: ["Library"],
  params: libraryItemParams,
  body: z.unknown().meta({ description: "The library item: a tool, skill or capability document, depending on {kind}." }),
  responses: {
    200: { description: "The saved item.", schema: libraryRecordDto },
    400: { description: "The body is not valid for this kind, or its name differs from the path." },
    422: { description: "The item fails its schema." },
  },
  handler: async ({ params, body }) => {
    const kind = SINGULAR_KIND[params.kind];
    const item = parseLibraryItem(kind, params.name, body);
    const record = await libraryCollection(await libraryRepository(), kind).save(item);
    return json(toLibraryRecordDto(record));
  },
});

export const deleteLibraryItem = defineRoute({
  method: "delete",
  path: "/library/{kind}/{name}",
  operationId: "deleteLibraryItem",
  summary: "Delete a library item",
  tags: ["Library"],
  params: libraryItemParams,
  responses: {
    204: { description: "Deleted." },
    404: { description: "No item with this name in the collection." },
  },
  handler: async ({ params }) => {
    await libraryCollection(await libraryRepository(), SINGULAR_KIND[params.kind]).remove(params.name);
    return new Response(null, { status: 204 });
  },
});

// ---------------------------------------------------------------- runtime capabilities

export const getLeleCapabilities = defineRoute({
  method: "get",
  path: "/runtimes/lele/capabilities",
  operationId: "getLeleCapabilities",
  summary: "Lele capabilities",
  description: "What the lele harness offers to agents: its capabilities (grantable plugins with their tools and argument schemas), skills, and the limitations the UI should state.",
  tags: ["Runtime"],
  responses: {
    200: { description: "The capabilities, skills and limitations.", schema: runtimeCapabilitiesDto },
    503: { description: "The lele harness could not be booted or read." },
  },
  handler: async () => {
    const catalog = await capabilityCatalog();
    return json({
      capabilities: await catalog.capabilities(),
      skills: await catalog.skills(),
      limitations: catalog.limitations(),
    });
  },
});

// ---------------------------------------------------------------- import

const importLineDto = z
  .object({
    kind: z.string(),
    name: z.string(),
    ok: z.boolean(),
    replaced: z.boolean().optional(),
    message: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .meta({ id: "ImportLine" });

const importReportDto = z
  .object({ lines: z.array(importLineDto), imported: z.number().int(), failed: z.number().int(), dryRun: z.boolean() })
  .meta({ id: "ImportReport" });

const importFolderDto = z
  .object({
    name: z.string().min(1).meta({ description: "Name of the uploaded folder; it names a single lele agent folder." }),
    files: uploadedFolderSchema.meta({ description: "Text files with paths relative to the folder." }),
    dryRun: z.boolean().default(false),
  })
  .meta({ id: "ImportFolderRequest" });

export const importFolder = defineRoute({
  method: "post",
  path: "/import",
  operationId: "importFolder",
  summary: "Import a folder",
  description:
    "Imports a folder of items: agent specs, lele AGENTS.md (folders or .md files), Goose recipes, tools, skills, capabilities, or a whole `agents dump` bundle. Bad files are reported per line.",
  tags: ["Import"],
  body: importFolderDto,
  responses: { 200: { description: "One line per item.", schema: importReportDto } },
  handler: async ({ body }) => {
    const [importer, codec] = [await importService(), bundleCodec()];
    const report = await withUploadedFolder(body.name, body.files, async (dir) => importer.import(await codec.read(dir), { dryRun: body.dryRun }));
    return json(report);
  },
});

// ---------------------------------------------------------------- projects

const projectParams = z.object({ project: z.string().meta({ description: "Project id, from GET /projects." }) });

export const listProjects = defineRoute({
  method: "get",
  path: "/projects",
  operationId: "listProjects",
  summary: "List projects",
  description:
    "Projects group agents and the external agent systems they connect to. `default` always exists and holds the agents from before projects.",
  tags: ["Projects"],
  responses: { 200: { description: "Projects, oldest first.", schema: z.array(projectDto) } },
  handler: async () => json((await (await projectRepository()).list()).map(toProjectDto)),
});

export const createProject = defineRoute({
  method: "post",
  path: "/projects",
  operationId: "createProject",
  summary: "Create a project",
  description: "The id is a slug of the name, made unique (name, name-2...).",
  tags: ["Projects"],
  body: projectInputDto,
  responses: { 201: { description: "The created project.", schema: projectDto } },
  handler: async ({ body }) => json(toProjectDto(await (await projectRepository()).create(body)), 201),
});

export const getProject = defineRoute({
  method: "get",
  path: "/projects/{project}",
  operationId: "getProject",
  summary: "Get a project",
  tags: ["Projects"],
  params: projectParams,
  responses: {
    200: { description: "The project.", schema: projectDto },
    404: { description: "No project with this id." },
  },
  handler: async ({ params }) => json(toProjectDto(await (await projectRepository()).get(params.project))),
});

export const updateProject = defineRoute({
  method: "put",
  path: "/projects/{project}",
  operationId: "updateProject",
  summary: "Update a project",
  description: "Replaces the name, description and systems. The id and the agents stay.",
  tags: ["Projects"],
  params: projectParams,
  body: projectInputDto,
  responses: {
    200: { description: "The updated project.", schema: projectDto },
    404: { description: "No project with this id." },
  },
  handler: async ({ params, body }) => json(toProjectDto(await (await projectRepository()).update(params.project, body))),
});

export const deleteProject = defineRoute({
  method: "delete",
  path: "/projects/{project}",
  operationId: "deleteProject",
  summary: "Delete a project",
  description: "Removes the project and its agents. The `default` project cannot be removed.",
  tags: ["Projects"],
  params: projectParams,
  responses: {
    204: { description: "Deleted." },
    404: { description: "No project with this id." },
    409: { description: "The project is protected (`default`)." },
  },
  handler: async ({ params }) => {
    await (await projectRepository()).remove(params.project);
    return new Response(null, { status: 204 });
  },
});

export const listProjectAgents = defineRoute({
  method: "get",
  path: "/projects/{project}/agents",
  operationId: "listProjectAgents",
  summary: "List a project's agents",
  description: "The project's own agents, as its agent system lists them. External systems are under /systems.",
  tags: ["Projects"],
  params: projectParams,
  responses: {
    200: { description: "Agent listings; unreadable agents carry a problem.", schema: z.array(agentListingDto) },
    404: { description: "No project with this id." },
  },
  handler: async ({ params }) => json(await (await projectOwnSystem(params.project)).list()),
});

export const importIntoProject = defineRoute({
  method: "post",
  path: "/projects/{project}/import",
  operationId: "importIntoProject",
  summary: "Import a folder into a project",
  description: "Same body and report as POST /import, but agents land in this project. Library items (tools, skills, capabilities) stay shared.",
  tags: ["Projects"],
  params: projectParams,
  body: importFolderDto,
  responses: {
    200: { description: "One line per item.", schema: importReportDto },
    404: { description: "No project with this id." },
  },
  handler: async ({ params, body }) => {
    const importer = await projectImportService(params.project);
    const codec = bundleCodec();
    const report = await withUploadedFolder(body.name, body.files, async (dir) => importer.import(await codec.read(dir), { dryRun: body.dryRun }));
    return json(report);
  },
});

// ---------------------------------------------------------------- agent systems

const systemParams = z.object({ system: z.string().meta({ description: "Agent system id, from GET /systems." }) });
const systemAgentParams = systemParams.extend({ agent: z.string().meta({ description: "Agent id within the system." }) });

export const listSystems = defineRoute({
  method: "get",
  path: "/systems",
  operationId: "listSystems",
  summary: "List agent systems",
  description: "The agentic systems configured in AGENT_SYSTEMS (builder, lele projects, folders, SQLite stores).",
  tags: ["Systems"],
  responses: { 200: { description: "Systems, in configuration order.", schema: z.array(agentSystemInfoDto) } },
  handler: async () => json((await agentSystems()).map((system) => system.info())),
});

export const listSystemAgents = defineRoute({
  method: "get",
  path: "/systems/{system}/agents",
  operationId: "listSystemAgents",
  summary: "List a system's agents",
  tags: ["Systems"],
  params: systemParams,
  responses: {
    200: { description: "Agent listings; unreadable agents carry a problem.", schema: z.array(agentListingDto) },
    404: { description: "No system with this id." },
  },
  handler: async ({ params }) => json(await (await agentSystem(params.system)).list()),
});

export const getSystemAgent = defineRoute({
  method: "get",
  path: "/systems/{system}/agents/{agent}",
  operationId: "getSystemAgent",
  summary: "Describe an agent in a system",
  description: "Capabilities with per-tool access, sub-agents, facts and the agent as the system stores it.",
  tags: ["Systems"],
  params: systemAgentParams,
  responses: {
    200: { description: "The agent.", schema: agentDescriptorDto },
    404: { description: "No system or agent with this id." },
  },
  handler: async ({ params }) => json(await (await agentSystem(params.system)).describe(params.agent)),
});
