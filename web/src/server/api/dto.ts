import "server-only";

import { z } from "zod";
import { agentSpecSchema, mcpServerRefSchema } from "@/core/agents/agent-spec";
import type { AgentRecord, AgentSummary } from "@/core/agents/agent-repository.port";

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
