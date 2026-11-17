import { parse, stringify } from "yaml";
import { instructionsText, toCapability, type CapabilityEntry, type DepsSchema, type GooseAgentSpec } from "@/core/agents/agent-spec";

/*
 * 1:1 mapping between the canonical AgentSpec and a Goose recipe.
 * The spec only holds what Goose can run, so export never loses anything.
 * Pure (no server-only, no node APIs) so the browser can preview the recipe.
 */

export interface GooseParameter {
  key: string;
  input_type: "string" | "number" | "boolean" | "date" | "file" | "select";
  requirement: "required" | "optional" | "user_prompt";
  description: string;
  default?: string;
  options?: string[];
}

export type GooseExtension =
  | { type: "stdio"; name: string; description: string; cmd: string; args?: string[]; envs?: Record<string, string>; env_keys?: string[]; cwd?: string; timeout?: number; available_tools?: string[] }
  | { type: "streamable_http"; name: string; description: string; uri: string; headers?: Record<string, string>; envs?: Record<string, string>; env_keys?: string[]; timeout?: number; available_tools?: string[] }
  | { type: "builtin"; name: string; description: string; timeout?: number; available_tools?: string[] }
  | { type: "platform"; name: string; description: string; available_tools?: string[] };

export interface GooseRecipe {
  version: string;
  title: string;
  description: string;
  instructions?: string;
  prompt?: string;
  parameters?: GooseParameter[];
  extensions?: GooseExtension[];
  settings?: { goose_provider?: string; goose_model?: string; temperature?: number; max_turns?: number };
  response?: { json_schema: Record<string, unknown> };
  sub_recipes?: GooseAgentSpec["sub_recipes"];
  retry?: GooseAgentSpec["retry"];
  activities?: string[];
}

export function toGooseRecipe(spec: GooseAgentSpec): { recipe: GooseRecipe; yaml: string; warnings: string[] } {
  const [provider, ...modelParts] = spec.model?.split(":") ?? [];
  const recipe: GooseRecipe = {
    version: "1.0.0",
    title: spec.name,
    description: spec.description || spec.name,
    instructions: instructionsText(spec) || undefined,
    prompt: spec.prompt,
    parameters: toParameters(spec.deps_schema),
    extensions: spec.capabilities.map(toExtension),
    settings: {
      goose_provider: provider || undefined,
      goose_model: modelParts.join(":") || undefined,
      temperature: spec.model_settings?.temperature,
      max_turns: spec.max_turns,
    },
    response: spec.output_schema ? { json_schema: spec.output_schema } : undefined,
    sub_recipes: spec.sub_recipes,
    retry: spec.retry,
    activities: spec.activities,
  };
  const clean = prune(recipe) as GooseRecipe;
  return { recipe: clean, yaml: stringify(clean, { lineWidth: 0, blockQuote: "literal" }), warnings: [] };
}

function toParameters(deps: DepsSchema | undefined): GooseParameter[] | undefined {
  if (!deps) return undefined;
  const required = new Set(deps.required ?? []);
  return Object.entries(deps.properties).map(([key, p]) => ({
    key,
    input_type: p.enum ? "select" : p.format ?? (p.type === "boolean" ? "boolean" : p.type === "string" ? "string" : "number"),
    requirement: required.has(key) ? "required" : "optional",
    description: p.description ?? key,
    default: p.default === undefined ? undefined : String(p.default),
    options: p.enum?.map(String),
  }));
}

function toExtension(entry: CapabilityEntry): GooseExtension {
  const capability = toCapability(entry);
  switch (capability.kind) {
    case "MCPStdio": {
      const a = capability.args;
      return { type: "stdio", name: a.id, description: a.description ?? "", cmd: a.command, args: a.args, envs: a.env, env_keys: a.env_keys, cwd: a.cwd, timeout: a.timeout, available_tools: a.allowed_tools };
    }
    case "MCP": {
      const a = capability.args;
      return { type: "streamable_http", name: a.id, description: a.description ?? "", uri: a.url, headers: a.headers, envs: a.env, env_keys: a.env_keys, timeout: a.timeout, available_tools: a.allowed_tools };
    }
    case "GooseExtension": {
      const a = capability.args;
      return a.type === "builtin"
        ? { type: "builtin", name: a.name, description: a.description ?? "", timeout: a.timeout, available_tools: a.allowed_tools }
        : { type: "platform", name: a.name, description: a.description ?? "", available_tools: a.allowed_tools };
    }
  }
}

/**
 * Goose recipe (object or YAML text) -> spec document. Returns warnings for recipe features the spec
 * can't hold (e.g. an `sse` extension or a `user_prompt` parameter); the caller validates the result.
 */
export function fromGooseRecipe(input: unknown): { spec: unknown; warnings: string[] } {
  const document = typeof input === "string" ? (parse(input) as unknown) : input;
  const wrapped = document as { recipe?: unknown };
  const r = (wrapped && typeof wrapped === "object" && "recipe" in wrapped ? wrapped.recipe : document) as Partial<GooseRecipe> & Record<string, unknown>;
  const warnings: string[] = [];

  const capabilities: CapabilityEntry[] = [];
  for (const ext of (r.extensions ?? []) as GooseExtension[]) {
    if (ext.type === "stdio") {
      capabilities.push({ MCPStdio: prune({ id: ext.name, description: ext.description || undefined, command: ext.cmd, args: ext.args, env: ext.envs, env_keys: ext.env_keys, cwd: ext.cwd, timeout: ext.timeout, allowed_tools: ext.available_tools }) as never });
    } else if (ext.type === "streamable_http") {
      capabilities.push({ MCP: prune({ id: ext.name, description: ext.description || undefined, url: ext.uri, headers: ext.headers, env: ext.envs, env_keys: ext.env_keys, timeout: ext.timeout, allowed_tools: ext.available_tools }) as never });
    } else if (ext.type === "builtin" || ext.type === "platform") {
      capabilities.push({ GooseExtension: prune({ type: ext.type, name: ext.name, description: ext.description || undefined, timeout: "timeout" in ext ? ext.timeout : undefined, allowed_tools: ext.available_tools }) as never });
    } else {
      warnings.push(`Extension "${(ext as { name?: string }).name}" of type "${(ext as { type?: string }).type}" isn't supported and was skipped.`);
    }
  }

  let deps_schema: DepsSchema | undefined;
  if (r.parameters?.length) {
    deps_schema = { type: "object", properties: {}, required: [] };
    for (const p of r.parameters) {
      if (p.requirement === "user_prompt") warnings.push(`Parameter "${p.key}" asked the user interactively; it is now required.`);
      const isRequired = p.requirement !== "optional";
      deps_schema.properties[p.key] = prune({
        type: p.input_type === "boolean" ? "boolean" : p.input_type === "number" ? "number" : "string",
        description: p.description,
        enum: p.input_type === "select" ? p.options : undefined,
        format: p.input_type === "date" || p.input_type === "file" ? p.input_type : undefined,
        default: isRequired ? undefined : p.default,
      }) as DepsSchema["properties"][string];
      if (isRequired) deps_schema.required!.push(p.key);
    }
  }

  const s = r.settings ?? {};
  const spec = prune({
    runtime: "goose",
    name: String(r.title ?? "agent").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[^A-Za-z_]+/, "") || "agent",
    description: r.description ?? "",
    model: s.goose_provider && s.goose_model ? `${s.goose_provider}:${s.goose_model}` : undefined,
    instructions: r.instructions,
    prompt: r.prompt,
    model_settings: s.temperature === undefined ? undefined : { temperature: s.temperature },
    capabilities,
    deps_schema,
    output_schema: r.response?.json_schema,
    max_turns: s.max_turns,
    retry: r.retry,
    sub_recipes: r.sub_recipes,
    activities: r.activities,
  });
  return { spec, warnings };
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? value.map(prune) : undefined;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => [k, prune(v)] as const).filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === "" ? undefined : value;
}
