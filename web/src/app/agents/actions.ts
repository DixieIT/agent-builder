"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parse as parseYaml } from "yaml";
import { parseAgentId, slugifyAgentId } from "@/core/agents/agent-id";
import {
  mcpServerRefSchema,
  newAgentSpec,
  validateAgentSpec,
  type SpecIssue,
} from "@/core/agents/agent-spec";
import { DomainError } from "@/core/shared/errors";
import type { InspectionResult } from "@/core/tools/tool-inspector.port";
import { agentRepository, toolInspector } from "@/server/container";
import { missingEnvKeys, toToolSource } from "@/server/tool-source";

export type ActionResult = { ok: true; updatedAt: string } | { ok: false; message: string; issues?: SpecIssue[] };

export async function createAgentAction(name: string): Promise<{ ok: false; message: string } | never> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Give the agent a name." };
  let id;
  try {
    id = slugifyAgentId(trimmed);
    const repository = await agentRepository();
    await repository.create(id, { ...newAgentSpec(id.replace(/-/g, "_")), description: trimmed });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath("/agents");
  redirect(`/agents/${id}`);
}

export async function importAgentAction(yamlText: string): Promise<{ ok: false; message: string; issues?: SpecIssue[] } | never> {
  let document: unknown;
  try {
    document = parseYaml(yamlText);
  } catch (error) {
    return { ok: false, message: `This is not valid YAML: ${messageOf(error)}` };
  }
  const { spec, issues } = validateAgentSpec(document);
  if (!spec) return { ok: false, message: "The YAML does not match the agent schema.", issues };
  let id;
  try {
    id = slugifyAgentId(spec.name);
    const repository = await agentRepository();
    await repository.create(id, spec);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath("/agents");
  redirect(`/agents/${id}`);
}

export async function saveAgentAction(rawId: string, input: unknown): Promise<ActionResult> {
  try {
    const id = parseAgentId(rawId);
    const { spec, issues } = validateAgentSpec(input);
    if (!spec) return { ok: false, message: "Fix the highlighted fields before saving.", issues };
    const repository = await agentRepository();
    const record = await repository.save(id, spec);
    revalidatePath("/agents");
    return { ok: true, updatedAt: record.updatedAt.toISOString() };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** Saves a document typed as YAML text, e.g. when repairing a file that no longer matches the schema. */
export async function saveAgentYamlAction(rawId: string, yamlText: string): Promise<ActionResult> {
  let document: unknown;
  try {
    document = parseYaml(yamlText);
  } catch (error) {
    return { ok: false, message: `This is not valid YAML: ${messageOf(error)}` };
  }
  const result = await saveAgentAction(rawId, document);
  if (result.ok) revalidatePath(`/agents/${rawId}`);
  return result;
}

export async function deleteAgentAction(rawId: string): Promise<{ ok: false; message: string } | never> {
  try {
    const repository = await agentRepository();
    await repository.remove(parseAgentId(rawId));
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath("/agents");
  redirect("/agents");
}

/** Connects to an MCP server described by an agent capability and lists its tools. */
export async function inspectMcpServerAction(input: unknown): Promise<InspectionResult> {
  const parsed = mcpServerRefSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), durationMs: 0 };
  }
  const ref = parsed.data;
  const result = await toolInspector().inspect(toToolSource(ref));
  if (result.status === "error" && ref.kind === "MCPStdio") {
    const missing = missingEnvKeys(ref.args);
    if (missing.length) result.message += ` (Not set in the builder's environment: ${missing.join(", ")}.)`;
  }
  return result;
}

function messageOf(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
