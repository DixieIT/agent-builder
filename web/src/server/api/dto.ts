import "server-only";

import { z } from "zod";
import { ENVIRONMENTS, envVarInputSchema, type EnvVar } from "@/core/environment/environment";
import { capabilitySchema, skillSchema, toolSchema } from "@/core/library/library";
import type { LibraryRecord } from "@/core/library/library-repository.port";
import { agentSpecSchema, mcpServerRefSchema, RUNTIMES } from "@/core/agents/agent-spec";
import type { AgentRecord, AgentSummary } from "@/core/agents/agent-repository.port";
import { projectInputSchema, systemSourceSchema, type Project } from "@/core/projects/project";

/*
 * Wire format of the REST API. Each named schema carries `.meta({ id })`, so buildOpenApi emits it as a component.
 * Dates travel as ISO 8601 strings.
 */

const iso = z.iso.datetime();

export const agentSpecDto = agentSpecSchema.meta({ id: "AgentSpec" });

export const specIssueDto = z
  .object({
    path: z.string(),
    message: z.string(),
    severity: z.enum(["error", "warning"]),
  })
  .meta({ id: "SpecIssue" });

export const validationReportDto = z
  .object({
    valid: z.boolean().meta({ description: "False when at least one issue has severity error." }),
    issues: z.array(specIssueDto),
  })
  .meta({ id: "ValidationReport" });

export const agentSummaryDto = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    model: z.string().optional(),
    capabilityCount: z.number().int(),
    updatedAt: iso,
    problem: z.string().optional().meta({ description: "Set when the stored document cannot be read as an AgentSpec." }),
  })
  .meta({ id: "AgentSummary" });

export const agentRecordDto = z
  .object({
    id: z.string(),
    spec: agentSpecDto,
    createdAt: iso,
    updatedAt: iso,
  })
  .meta({ id: "AgentRecord" });

export const mcpServerRefDto = mcpServerRefSchema.meta({ id: "McpServerRef" });

const jsonSchemaDto = z.looseObject({
  type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

export const toolDescriptorDto = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: jsonSchemaDto,
    annotations: z
      .object({
        readOnlyHint: z.boolean().optional(),
        destructiveHint: z.boolean().optional(),
        idempotentHint: z.boolean().optional(),
        openWorldHint: z.boolean().optional(),
      })
      .optional(),
  })
  .meta({ id: "ToolDescriptor" });

export const inspectionResultDto = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      server: z.object({ name: z.string(), version: z.string() }),
      instructions: z.string().optional(),
      tools: z.array(toolDescriptorDto),
      durationMs: z.number(),
    }),
    z.object({
      status: z.literal("error"),
      message: z.string(),
      stderr: z.string().optional(),
      durationMs: z.number(),
    }),
  ])
  .meta({ id: "InspectionResult" });

export const runRequestDto = z
  .object({
    params: z.record(z.string(), z.string()).default({}).meta({ description: "Values for the template variables in deps_schema." }),
    prompt: z.string().optional().meta({ description: "Overrides the starting prompt of the recipe." }),
    environment: z.enum(ENVIRONMENTS).default("development").meta({ description: "Which environment's variables the run receives." }),
  })
  .meta({ id: "RunRequest" })
  .prefault({});

export const buildRequestDto = z
  .object({
    tag: z.string().optional().meta({ description: 'Image tag. Default: "uab/<id>:latest".' }),
  })
  .meta({ id: "BuildRequest" })
  .prefault({});

export const buildContextDto = z
  .object({
    files: z.record(z.string(), z.string()).meta({ description: "Build context files, path -> contents." }),
  })
  .meta({ id: "BuildContext" });

export const runtimeStatusDto = z
  .object({
    runner: z.string(),
    available: z.boolean(),
    version: z.string().optional(),
    detail: z.string(),
  })
  .meta({ id: "RuntimeStatus" });

export const storeCheckDto = z
  .object({
    name: z.string(),
    ok: z.boolean(),
    detail: z.string(),
  })
  .meta({ id: "StoreCheck" });

export const storeStatusDto = z
  .object({
    kind: z.enum(["fs", "mongo"]),
    checks: z.array(storeCheckDto),
  })
  .meta({ id: "StoreStatus" });

export const gooseExportDto = z
  .object({
    yaml: z.string(),
    warnings: z.array(z.string()),
  })
  .meta({ id: "GooseExport" });

export const saveResultDto = z
  .object({
    record: agentRecordDto,
    issues: z.array(specIssueDto),
  })
  .meta({ id: "SaveResult" });

export const gooseImportResultDto = z
  .object({
    record: agentRecordDto,
    warnings: z.array(z.string()),
  })
  .meta({ id: "GooseImportResult" });

export function toRecordDto(record: AgentRecord): z.infer<typeof agentRecordDto> {
  return {
    id: record.id,
    spec: record.spec,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toSummaryDto(summary: AgentSummary): z.infer<typeof agentSummaryDto> {
  return { ...summary, updatedAt: summary.updatedAt.toISOString() };
}

// ---------------------------------------------------------------- projects

export const projectInputDto = projectInputSchema.meta({ id: "ProjectInput" });

export const projectDto = z
  .object({
    id: z.string().meta({ description: "Slug of the name, unique among projects." }),
    name: z.string(),
    description: z.string(),
    systems: z.array(systemSourceSchema).meta({ description: "External agent systems attached to the project." }),
    createdAt: iso,
    updatedAt: iso,
  })
  .meta({ id: "Project" });

export function toProjectDto(project: Project): z.infer<typeof projectDto> {
  return { ...project, createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString() };
}

// ---------------------------------------------------------------- environment

const envSourceDto = z
  .object({
    kind: z.enum(["folder", "sqlite"]),
    label: z.string(),
    location: z.string().meta({ description: "Folder path or database file." }),
    writable: z.boolean(),
  })
  .meta({ id: "EnvSource" });

export const envVarDto = z
  .object({
    key: z.string(),
    environments: z.array(z.enum(ENVIRONMENTS)),
    sensitive: z.boolean(),
    value: z.string().optional().meta({ description: "Plain value; absent for sensitive variables." }),
    preview: z.string().meta({ description: 'Masked value, e.g. "sk-…a1b2".' }),
    comment: z.string().optional(),
    updatedAt: iso,
  })
  .meta({ id: "EnvVar" });

export const environmentListingDto = z
  .object({
    source: envSourceDto,
    variables: z.array(envVarDto),
  })
  .meta({ id: "EnvironmentListing" });

/** The body of a PUT: the variable without its key, which comes from the path. */
export const envVarInputDto = envVarInputSchema.omit({ key: true }).meta({ id: "EnvVarInput" });

export const resolveEnvironmentRequestDto = z
  .object({
    environment: z.enum(ENVIRONMENTS),
    keys: z.array(z.string()),
  })
  .meta({ id: "ResolveEnvironmentRequest" });

export const resolveEnvironmentResultDto = z
  .object({
    values: z.record(z.string(), z.string()),
    missing: z.array(z.string()),
  })
  .meta({ id: "ResolveEnvironmentResult" });

export function toEnvVarDto(variable: EnvVar): z.infer<typeof envVarDto> {
  return { ...variable, updatedAt: variable.updatedAt.toISOString() };
}

// ---------------------------------------------------------------- library

const libraryToolRecordDto = z
  .object({ item: toolSchema.meta({ id: "LibraryTool" }), createdAt: iso, updatedAt: iso })
  .meta({ id: "LibraryToolRecord" });
const librarySkillRecordDto = z
  .object({ item: skillSchema.meta({ id: "LibrarySkill" }), createdAt: iso, updatedAt: iso })
  .meta({ id: "LibrarySkillRecord" });
const libraryCapabilityRecordDto = z
  .object({ item: capabilitySchema.meta({ id: "LibraryCapability" }), createdAt: iso, updatedAt: iso })
  .meta({ id: "LibraryCapabilityRecord" });

/** A record of any library collection; the path's kind says which one. */
export const libraryRecordDto = z.union([libraryToolRecordDto, librarySkillRecordDto, libraryCapabilityRecordDto]);

export function toLibraryRecordDto<T>(record: LibraryRecord<T>): { item: T; createdAt: string; updatedAt: string } {
  return { item: record.item, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() };
}

// ---------------------------------------------------------------- runtime catalog

const capabilityToolDto = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: jsonSchemaDto.optional().meta({ description: "JSON Schema of the arguments, as the model receives it." }),
    deferred: z.boolean().meta({ description: "Not in the agent's tool list until loaded on demand (lele: load_skill <group>)." }),
    group: z.string().meta({ description: "Finer grant name inside the capability; equal to the capability id when there are no finer groups." }),
  })
  .meta({ id: "CapabilityTool" });

const capabilityDto = z
  .object({
    id: z.string().meta({ description: "The grant name: a lele plugin label, a Goose extension name." }),
    runtime: z.enum(RUNTIMES),
    description: z.string(),
    tools: z.array(capabilityToolDto),
  })
  .meta({ id: "Capability" });

const runtimeSkillDto = z
  .object({
    name: z.string(),
    description: z.string(),
    source: z.enum(["package", "global", "project"]),
    path: z.string(),
    grantable: z.boolean().meta({ description: "Whether an agent can force-load it by granting it active." }),
  })
  .meta({ id: "RuntimeSkill" });

export const runtimeCapabilitiesDto = z
  .object({
    capabilities: z.array(capabilityDto),
    skills: z.array(runtimeSkillDto),
    limitations: z.array(z.string()),
  })
  .meta({ id: "RuntimeCapabilities" });

// ---------------------------------------------------------------- agent systems

export const agentSystemInfoDto = z
  .object({
    id: z.string().meta({ description: "Stable id used in URLs, e.g. builder, lele." }),
    label: z.string(),
    kind: z.string().meta({ description: "Adapter kind: builder-store, lele, fs, sqlite." }),
    location: z.string().meta({ description: "Where the agents live: a folder, a database file, a URL." }),
    editable: z.boolean().meta({ description: "Whether the builder can edit these agents." }),
  })
  .meta({ id: "AgentSystemInfo" });

export const agentListingDto = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    model: z.string().optional(),
    capabilityCount: z.number().int(),
    subAgentCount: z.number().int(),
    problem: z.string().optional().meta({ description: "Set when the agent couldn't be read." }),
  })
  .meta({ id: "AgentListing" });

const capabilityToolAccessDto = z.enum(["granted", "on-demand", "denied", "unknown"]);

export const capabilityViewDto = z
  .object({
    capability: capabilityDto,
    tools: z.array(z.object({ tool: capabilityToolDto, access: capabilityToolAccessDto })),
    note: z.string().optional(),
    inspectable: z.unknown().optional().meta({ description: "Present when the tools can be listed live (an MCP server): what the inspector needs." }),
  })
  .meta({ id: "CapabilityView" });

export const subAgentLinkDto = z
  .object({
    id: z.string(),
    via: z.string().meta({ description: 'How the delegation is declared, e.g. "subagent tool", "sub_recipe".' }),
  })
  .meta({ id: "SubAgentLink" });

export const agentDescriptorDto = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    model: z.string().optional(),
    instructions: z.string().optional(),
    capabilities: z.array(capabilityViewDto),
    subAgents: z.array(subAgentLinkDto),
    facts: z.array(z.object({ label: z.string(), value: z.string() })),
    native: z
      .object({ format: z.string(), text: z.string() })
      .optional()
      .meta({ description: "The agent as the system stores it, for view source." }),
    editPath: z.string().optional().meta({ description: "Builder editor path when the agent is editable here." }),
  })
  .meta({ id: "AgentDescriptor" });
