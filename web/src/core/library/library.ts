import { z } from "zod";
import { capabilityEntrySchema } from "@/core/agents/agent-spec";

/**
 * The library: reusable building blocks that live independently of agents and can be dumped to a folder
 * and imported one by one.
 *  - Tool        code + described args + instructions (served to agents as an MCP server / lele extension)
 *  - Skill       a SKILL.md document plus optional supporting files
 *  - Capability  a saved extension config (MCP stdio/http server, Goose extension) ready to attach to agents
 */

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, - and _.");

export const TOOL_LANGUAGES = ["python", "typescript", "shell"] as const;
export type ToolLanguage = (typeof TOOL_LANGUAGES)[number];

const argSchema = z.looseObject({
  type: z.string().optional(),
  description: z.string().optional(),
});

export const toolSchema = z.strictObject({
  name: slug,
  description: z.string().min(1, "Say what the tool does; the model reads this to decide when to call it."),
  /** Longer usage guidance, loaded with the tool (and shown when a deferred tool is loaded). */
  instructions: z.string().default(""),
  /** JSON Schema for the arguments. Every property should carry a description. */
  input_schema: z.strictObject({
    type: z.literal("object"),
    properties: z.record(z.string(), argSchema).default({}),
    required: z.array(z.string()).default([]),
  }),
  /** Deferred tools are not in the prompt up front; the agent loads them on demand. */
  deferred: z.boolean().default(false),
  language: z.enum(TOOL_LANGUAGES),
  /** Source of the handler. Python: `def run(**args) -> str`; TypeScript: `export default async (args) => string`; shell: script reading JSON args on stdin. */
  code: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  /** Variables the tool needs at run time (resolved from the environment store). */
  env_keys: z.array(z.string()).default([]),
});

export const skillSchema = z.strictObject({
  name: slug,
  description: z.string().min(1),
  /** SKILL.md body (markdown, without frontmatter). */
  body: z.string().min(1),
  /** Supporting files next to SKILL.md, path -> text content. */
  files: z.record(z.string(), z.string()).default({}),
});

export const capabilitySchema = z.strictObject({
  name: slug,
  description: z.string().default(""),
  /** The capability exactly as it appears in an agent's `capabilities` list. */
  entry: capabilityEntrySchema,
});

export type Tool = z.infer<typeof toolSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type LibraryCapability = z.infer<typeof capabilitySchema>;

export const LIBRARY_KINDS = ["tool", "skill", "capability"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export type LibraryItem =
  | { kind: "tool"; item: Tool }
  | { kind: "skill"; item: Skill }
  | { kind: "capability"; item: LibraryCapability };

export const librarySchemas = { tool: toolSchema, skill: skillSchema, capability: capabilitySchema } as const;
