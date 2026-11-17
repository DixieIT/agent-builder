import { parse, stringify } from "yaml";

import { leleAgentSpecSchema, type LeleAgentSpec, type LeleGrant } from "@/core/agents/agent-spec";
import { InvalidAgentDocumentError } from "@/core/shared/errors";

/**
 * lele sub-agent file: `---\n<yaml frontmatter>\n---\n<body>`, where the body is the system prompt.
 * Mirrors lele's own reader (packages/context `_parse_front_matter`) and `lele agent create` writer.
 * Pure: no filesystem access.
 */

const FENCE = "---";
const YAML_OPTIONS = { lineWidth: 0, sortKeys: false, version: "1.1" } as const;

/** Splits front matter from body the way lele does. Without a closing fence the whole text is body. */
export function splitFrontMatter(input: string): { yaml: string | undefined; body: string } {
  const text = input.split(String.fromCharCode(13)).join("");
  if (text.startsWith(FENCE)) {
    const end = text.indexOf(FENCE, FENCE.length);
    if (end !== -1) {
      return { yaml: text.slice(FENCE.length, end), body: text.slice(end + FENCE.length).trim() };
    }
  }
  return { yaml: undefined, body: text.trim() };
}

/**
 * Reads an AGENTS.md. `folderName` is the agent name unless the front matter sets `name` (lele's rule).
 * Throws InvalidAgentDocumentError when the YAML or the resulting spec is invalid.
 */
export function parseLeleAgentFile(text: string, folderName: string): LeleAgentSpec {
  const { yaml, body } = splitFrontMatter(text);
  const meta = readMeta(folderName, text, yaml);

  const name = typeof meta.name === "string" && meta.name.trim() ? meta.name.trim() : folderName;
  const description = scalar(meta.description);
  const model = scalar(meta.model);
  const candidate = {
    runtime: "lele" as const,
    name,
    description,
    ...(model ? { model } : {}),
    instructions: body,
    capabilities: normalizeTools(meta),
    ...(meta.hidden === true ? { hidden: true } : {}),
    ...(meta.simple === true ? { simple: true } : {}),
  };

  const parsed = leleAgentSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InvalidAgentDocumentError(
      folderName,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
      text,
    );
  }
  return parsed.data;
}

/**
 * Writes an AGENTS.md the way `lele agent create` does: frontmatter without `name` (the folder is the name),
 * no `runtime`, empty values dropped, body after the closing fence, trailing newline.
 */
export function formatLeleAgentFile(spec: LeleAgentSpec): string {
  const meta: Record<string, unknown> = {};
  if (spec.description) meta.description = spec.description;
  if (spec.model) meta.model = spec.model;
  if (Object.keys(spec.capabilities).length > 0) meta.tools = { ...spec.capabilities };
  if (spec.hidden) meta.hidden = true;
  if (spec.simple) meta.simple = true;
  return `---\n${stringify(meta, YAML_OPTIONS)}\n---\n${spec.instructions.trim()}\n`;
}

function readMeta(folderName: string, text: string, yaml: string | undefined): Record<string, unknown> {
  if (yaml === undefined) return {};
  let value: unknown;
  try {
    value = parse(yaml, { version: "1.1" });
  } catch (error) {
    throw new InvalidAgentDocumentError(folderName, [`(root): invalid YAML: ${error instanceof Error ? error.message : String(error)}`], text);
  }
  return isRecord(value) ? value : {};
}

/**
 * `tools` is the grant map; the legacy `skills` key is read only when `tools` is absent.
 * true/"active" -> active, false/"disabled" -> disabled, "available" is kept as written (lele treats it as
 * not granted, but dropping it would rewrite the file). A list or a string grants every name it holds.
 */
function normalizeTools(meta: Record<string, unknown>): Record<string, LeleGrant> {
  const source = "tools" in meta ? meta.tools : meta.skills;
  const grants: Record<string, LeleGrant> = {};
  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === "string" && item.trim()) grants[item.trim()] = "active";
    }
  } else if (typeof source === "string") {
    for (const name of source.split(/[\s,]+/)) {
      if (name) grants[name] = "active";
    }
  } else if (isRecord(source)) {
    for (const [name, value] of Object.entries(source)) {
      const grant = grantOf(value);
      if (name && grant) grants[name] = grant;
    }
  }
  return grants;
}

function grantOf(value: unknown): LeleGrant | undefined {
  if (value === true || value === "active") return "active";
  if (value === false || value === "disabled") return "disabled";
  if (value === "available") return "available";
  return undefined;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
