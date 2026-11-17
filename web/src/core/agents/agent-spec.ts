import { z } from "zod";

/**
 * Canonical AgentSpec. Goose is the runtime, so the spec holds exactly what a Goose recipe can run:
 * every field maps 1:1 to a recipe field and nothing is lost on export. Naming follows the Pydantic AI
 * AgentSpec where the concepts match (name, model, instructions, capabilities, deps_schema, output_schema).
 * Objects are strict: a key Goose can't run is an error, not a silently dropped value.
 */

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, "Use letters, digits, - and _; start with a letter.");
const toolNames = z.array(z.string().min(1));
const seconds = z.number().int().positive();

/** stdio extension: an MCP server started as a subprocess. */
export const mcpStdioArgsSchema = z.strictObject({
  id: identifier,
  description: z.string().optional(),
  command: z.string().min(1, "Set the command."),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_keys: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  timeout: seconds.optional(),
  allowed_tools: toolNames.optional(),
});

/** streamable_http extension: a remote MCP server. */
export const mcpArgsSchema = z.strictObject({
  id: identifier,
  description: z.string().optional(),
  url: z.string().url("Use a full URL, e.g. https://mcp.example.com/mcp"),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_keys: z.array(z.string()).optional(),
  timeout: seconds.optional(),
  allowed_tools: toolNames.optional(),
});

/** builtin / platform extension shipped with Goose (e.g. developer). */
export const gooseExtensionArgsSchema = z.strictObject({
  type: z.enum(["builtin", "platform"]),
  name: z.string().min(1),
  description: z.string().optional(),
  timeout: seconds.optional(),
  allowed_tools: toolNames.optional(),
});

export type McpStdioArgs = z.infer<typeof mcpStdioArgsSchema>;
export type McpArgs = z.infer<typeof mcpArgsSchema>;
export type GooseExtensionArgs = z.infer<typeof gooseExtensionArgsSchema>;

/** Capabilities use the Pydantic AI single-key form: `- MCPStdio: {...}`. Each one is a Goose extension. */
export const capabilityEntrySchema = z.union([
  z.strictObject({ MCPStdio: mcpStdioArgsSchema }),
  z.strictObject({ MCP: mcpArgsSchema }),
  z.strictObject({ GooseExtension: gooseExtensionArgsSchema }),
]);

export const CAPABILITY_KINDS = ["MCPStdio", "MCP", "GooseExtension"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** A tool server the builder can connect to and inspect. */
export const mcpServerRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MCP"), args: mcpArgsSchema }),
  z.object({ kind: z.literal("MCPStdio"), args: mcpStdioArgsSchema }),
]);
export type McpServerArgs = z.infer<typeof mcpServerRefSchema>;

/** JSON Schema subset that maps to Goose recipe parameters. */
const depsPropertySchema = z.strictObject({
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  format: z.enum(["date", "file"]).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const depsSchemaSchema = z.strictObject({
  type: z.literal("object"),
  properties: z.record(identifier, depsPropertySchema),
  required: z.array(z.string()).optional(),
});

/** Free JSON Schema: becomes the recipe's response.json_schema. */
const outputSchemaSchema = z.looseObject({
  type: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
});

export const retrySchema = z.strictObject({
  max_retries: z.number().int().min(1).max(20),
  checks: z.array(z.strictObject({ type: z.literal("shell"), command: z.string().min(1) })).min(1, "Add at least one check; Goose retries when a check fails."),
  timeout_seconds: seconds.optional(),
  on_failure_timeout_seconds: seconds.optional(),
  on_failure: z.string().optional(),
});

export const subRecipeSchema = z.strictObject({
  name: identifier,
  path: z.string().min(1),
  description: z.string().optional(),
  values: z.record(z.string(), z.string()).optional(),
  sequential_when_repeated: z.boolean().optional(),
});

export const agentSpecSchema = z.strictObject({
  name: identifier,
  description: z.string().default(""),
  model: z.string().regex(/^[\w.-]+:[\w./:@-]+$/, 'Use "provider:model", e.g. anthropic:claude-opus-5-5').optional(),
  instructions: z.union([z.string(), z.array(z.string())]).optional(),
  prompt: z.string().optional(),
  model_settings: z.strictObject({ temperature: z.number().min(0).max(2).optional() }).optional(),
  capabilities: z.array(capabilityEntrySchema).default([]),
  deps_schema: depsSchemaSchema.optional(),
  output_schema: outputSchemaSchema.optional(),
  max_turns: z.number().int().positive().optional(),
  retry: retrySchema.optional(),
  sub_recipes: z.array(subRecipeSchema).optional(),
  activities: z.array(z.string()).optional(),
});

export type AgentSpec = z.infer<typeof agentSpecSchema>;
export type CapabilityEntry = z.infer<typeof capabilityEntrySchema>;
export type DepsSchema = z.infer<typeof depsSchemaSchema>;
export type Retry = z.infer<typeof retrySchema>;

export type Capability =
  | { kind: "MCPStdio"; args: McpStdioArgs }
  | { kind: "MCP"; args: McpArgs }
  | { kind: "GooseExtension"; args: GooseExtensionArgs };

export function toCapability(entry: CapabilityEntry): Capability {
  const [kind, args] = Object.entries(entry)[0];
  return { kind, args } as Capability;
}

export function fromCapability(capability: Capability): CapabilityEntry {
  return { [capability.kind]: capability.args } as CapabilityEntry;
}

export function capabilities(spec: AgentSpec): Capability[] {
  return spec.capabilities.map(toCapability);
}

/** What the "Add capability" menu offers. Each item is a Goose extension type. */
export const CAPABILITY_CATALOG: { kind: CapabilityKind; label: string; summary: string; defaults: Capability["args"] }[] = [
  { kind: "MCPStdio", label: "MCP server (local)", summary: "Goose stdio extension: starts an MCP server as a subprocess.", defaults: { id: "server", command: "" } },
  { kind: "MCP", label: "MCP server (remote)", summary: "Goose streamable_http extension: connects to an MCP server URL.", defaults: { id: "remote", url: "https://" } },
  { kind: "GooseExtension", label: "Goose extension", summary: "An extension that ships with Goose, e.g. developer.", defaults: { type: "builtin", name: "developer" } },
];

export function newAgentSpec(name: string): AgentSpec {
  return agentSpecSchema.parse({ name, description: "", model: "anthropic:claude-opus-5-5", instructions: "", capabilities: [] });
}

export function instructionsText(spec: { instructions?: string | string[] }): string {
  return Array.isArray(spec.instructions) ? spec.instructions.join("\n\n") : (spec.instructions ?? "");
}

const TEMPLATE_VAR = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|[^}]*)?\}\}/g;
const BUILTIN_VARS = new Set(["recipe_dir"]);

/** Template variables used in instructions, prompt and activities, e.g. {{user_name}}. */
export function templateVariables(spec: AgentSpec): string[] {
  const found = new Set<string>();
  for (const text of [instructionsText(spec), spec.prompt, ...(spec.activities ?? [])]) {
    for (const match of (text ?? "").matchAll(TEMPLATE_VAR)) if (!BUILTIN_VARS.has(match[1])) found.add(match[1]);
  }
  return [...found];
}

export interface SpecIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

/** Schema errors plus the recipe rules Goose enforces when it loads a recipe. */
export function validateAgentSpec(input: unknown): { spec?: AgentSpec; issues: SpecIssue[] } {
  const parsed = agentSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.code === "unrecognized_keys" ? `Goose can't run ${issue.keys.join(", ")}; remove it.` : issue.message,
        severity: "error",
      })),
    };
  }
  const spec = parsed.data;
  const issues: SpecIssue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, severity: "error" });


  if (!instructionsText(spec).trim() && !spec.prompt?.trim()) error("instructions", "Add instructions or a prompt.");
  if (!spec.model) issues.push({ path: "model", message: "No model set; Goose uses its configured default.", severity: "warning" });

  const properties = spec.deps_schema?.properties ?? {};
  const required = new Set(spec.deps_schema?.required ?? []);
  const used = new Set(templateVariables(spec));
  for (const variable of used) {
    if (!(variable in properties)) error("deps_schema", `{{${variable}}} is used but not declared as an input.`);
  }
  for (const [key, property] of Object.entries(properties)) {
    const path = `deps_schema.properties.${key}`;
    if (!used.has(key)) error(path, `Input "${key}" isn't used in the instructions or prompt; Goose rejects unused parameters.`);
    if (required.has(key) && property.default !== undefined) error(path, `Required input "${key}" can't have a default.`);
    if (!required.has(key) && property.default === undefined) error(path, `Optional input "${key}" needs a default.`);
    if (property.format === "file" && property.default !== undefined) error(path, `File input "${key}" can't have a default.`);
  }
  for (const key of required) if (!(key in properties)) error("deps_schema.required", `"${key}" is required but not declared.`);

  const ids = new Set<string>();
  spec.capabilities.forEach((entry, index) => {
    const capability = toCapability(entry);
    const id = capability.kind === "GooseExtension" ? capability.args.name : capability.args.id;
    if (ids.has(id)) error(`capabilities.${index}`, `Two extensions are named "${id}".`);
    ids.add(id);
  });

  return { spec, issues };
}
