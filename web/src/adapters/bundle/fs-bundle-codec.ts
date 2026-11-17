import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type { z } from "zod";

import { isAgentId, slugifyAgentId } from "@/core/agents/agent-id";
import { agentSpecSchema } from "@/core/agents/agent-spec";
import type { BundleCodec, BundleContent } from "@/core/library/bundle.port";
import {
  capabilitySchema,
  skillSchema,
  TOOL_LANGUAGES,
  toolSchema,
  type LibraryItem,
  type ToolLanguage,
} from "@/core/library/library";

/**
 * Folder representation of a bundle (layout in bundle.port.ts). Filesystem and YAML only; the schemas
 * in core decide what is valid, in both directions.
 */

const YAML_OPTIONS = { lineWidth: 0, blockQuote: "literal" } as const;
const MAX_SUPPORTING_FILE_BYTES = 1024 * 1024;
const MAIN_FILE: Record<ToolLanguage, string> = { python: "main.py", typescript: "main.ts", shell: "main.sh" };
const ROOT_FOLDERS = ["agents", "tools", "skills", "capabilities"] as const;
const YAML_FILE = /\.ya?ml$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

type Problems = string[];

interface Collector {
  agents: BundleContent["agents"];
  items: LibraryItem[];
  native: NonNullable<BundleContent["native"]>;
  problems: Problems;
}

export class FsBundleCodec implements BundleCodec {
  async dump(dir: string, content: BundleContent): Promise<string[]> {
    const written: string[] = [];
    const write = async (file: string, text: string) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
      written.push(file);
    };
    const names: Record<"agents" | "tools" | "skills" | "capabilities", string[]> = {
      agents: [],
      tools: [],
      skills: [],
      capabilities: [],
    };

    for (const { id, spec } of content.agents) {
      if (!isAgentId(id)) throw new Error(`Agent id "${id}" is not valid; use lowercase letters, digits, - and _.`);
      const agent = validated(agentSpecSchema, spec, `agents/${id}`);
      await write(path.join(dir, "agents", id, "agent.yaml"), stringify(agent, YAML_OPTIONS));
      names.agents.push(id);
    }

    for (const entry of content.items) {
      switch (entry.kind) {
        case "tool": {
          const tool = validated(toolSchema, entry.item, `tools/${entry.item.name}`);
          const folder = path.join(dir, "tools", tool.name);
          const { code, ...meta } = tool;
          await write(path.join(folder, "tool.yaml"), stringify(meta, YAML_OPTIONS));
          await write(path.join(folder, MAIN_FILE[tool.language]), code);
          if (tool.language === "python" && tool.dependencies.length > 0) {
            await write(path.join(folder, "requirements.txt"), `${tool.dependencies.join("\n")}\n`);
          }
          names.tools.push(tool.name);
          break;
        }
        case "skill": {
          const skill = validated(skillSchema, entry.item, `skills/${entry.item.name}`);
          const folder = path.join(dir, "skills", skill.name);
          const frontmatter = stringify({ name: skill.name, description: skill.description }, YAML_OPTIONS);
          await write(path.join(folder, "SKILL.md"), `---\n${frontmatter}---\n${skill.body}`);
          for (const [rel, text] of Object.entries(skill.files)) {
            const problem = supportingFileProblem(rel);
            if (problem) throw new Error(`skills/${skill.name}: supporting file "${rel}" ${problem}.`);
            await write(path.join(folder, ...rel.split("/")), text);
          }
          names.skills.push(skill.name);
          break;
        }
        case "capability": {
          const capability = validated(capabilitySchema, entry.item, `capabilities/${entry.item.name}`);
          await write(path.join(dir, "capabilities", `${capability.name}.yaml`), stringify(capability, YAML_OPTIONS));
          names.capabilities.push(capability.name);
          break;
        }
      }
    }

    await write(path.join(dir, "README.md"), readme(names));
    return written;
  }

  async read(source: string): Promise<BundleContent> {
    const out: Collector = { agents: [], items: [], native: [], problems: [] };
    const info = await stat(source).catch(() => undefined);
    if (!info) throw new Error(`Bundle path does not exist: ${source}`);
    if (info.isDirectory()) await collectDir(source, out, true);
    else await collectFile(source, out);
    const found = out.agents.length + out.items.length + out.native.length;
    // A single bad item (or a folder with nothing usable) is an error; a folder with some bad files is not.
    if (found === 0 && out.problems.length > 0) {
      throw new Error(`Invalid bundle ${source}:\n${out.problems.map((problem) => `  ${problem}`).join("\n")}`);
    }
    return {
      agents: out.agents,
      items: out.items,
      ...(out.native.length ? { native: out.native } : {}),
      ...(out.problems.length ? { problems: out.problems } : {}),
    };
  }
}

// ---- dump helpers ------------------------------------------------------------------------------

function validated<T extends z.ZodType>(schema: T, value: unknown, where: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(issueLines(where, result.error.issues).join("\n"));
  return result.data;
}

/** Returns why a skill's supporting file path is not allowed, or undefined when it is fine. */
function supportingFileProblem(rel: string): string | undefined {
  if (!rel || rel.includes("\\") || path.posix.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return "must be a relative path with / separators";
  const segments = rel.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.startsWith("."))) {
    return "must not contain ., .., empty or dot segments";
  }
  if (rel === "SKILL.md") return "clashes with SKILL.md, which is written from name, description and body";
  return undefined;
}

function readme(names: Record<"agents" | "tools" | "skills" | "capabilities", string[]>): string {
  const list = (values: string[]) => (values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", "));
  return [
    "# Agent bundle",
    "",
    "Exported from Ultimate Agent Builder. Each folder or file is one item and can be imported on its own.",
    "",
    "## Contents",
    "",
    `- Agents (${names.agents.length}): ${list(names.agents)}`,
    `- Tools (${names.tools.length}): ${list(names.tools)}`,
    `- Skills (${names.skills.length}): ${list(names.skills)}`,
    `- Capabilities (${names.capabilities.length}): ${list(names.capabilities)}`,
    "",
    "## Importing",
    "",
    "Import one item (or this whole folder) from the web directory:",
    "",
    "```sh",
    "bun run agents import <path>",
    "```",
    "",
    "`<path>` can be a tool folder (`tools/<name>`), a skill folder (`skills/<name>`), a capability file (`capabilities/<name>.yaml`), an agent folder (`agents/<id>`), or this folder. Add `--dry-run` to validate without saving.",
    "",
  ].join("\n");
}

// ---- read helpers ------------------------------------------------------------------------------

function issueLines(where: string, issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => `${where}: ${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
}

function report(out: Collector, where: string, issues: readonly { path: PropertyKey[]; message: string }[]): void {
  out.problems.push(...issueLines(where, issues));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readText(file: string, out: Collector): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    out.problems.push(`${file}: cannot read (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

/** Parses YAML; returns undefined (and records a problem) when the text is not valid YAML. */
function parseYaml(text: string, file: string, out: Collector): { value: unknown } | undefined {
  try {
    return { value: parse(text) };
  } catch (error) {
    out.problems.push(`${file}: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

async function isDirectory(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined))?.isDirectory() ?? false;
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined))?.isFile() ?? false;
}

/**
 * A dir is one item when it holds tool.yaml, SKILL.md, agent.yaml or a lele AGENTS.md; a dump root when it has
 * agents/, tools/, skills/ or capabilities/; otherwise (top level only) a plain collection of items.
 */
async function collectDir(folder: string, out: Collector, topLevel = false): Promise<void> {
  if (await exists(path.join(folder, "tool.yaml"))) return readTool(folder, out);
  if (await exists(path.join(folder, "SKILL.md"))) return readSkill(folder, out);
  if (await exists(path.join(folder, "agent.yaml"))) return readAgentFile(path.join(folder, "agent.yaml"), out);
  if (await exists(path.join(folder, "AGENTS.md"))) return readLeleAgent(path.join(folder, "AGENTS.md"), path.basename(folder), out);

  let found = false;
  for (const sub of ROOT_FOLDERS) {
    const subFolder = path.join(folder, sub);
    if (!(await isDirectory(subFolder))) continue;
    found = true;
    for (const entry of await readdir(subFolder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(subFolder, entry.name);
      if (entry.isDirectory()) await collectDir(full, out);
      else if (entry.isFile() && YAML_FILE.test(entry.name)) await collectFile(full, out);
    }
  }
  if (found) return;
  if (!topLevel) {
    out.problems.push(`${folder}: not a tool (tool.yaml), skill (SKILL.md), agent (agent.yaml, AGENTS.md) or bundle root`);
    return;
  }
  // A plain folder of items: agents/, .lele/agents, a folder of recipes or of tool folders.
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await collectDir(full, out);
    else if (entry.isFile() && (YAML_FILE.test(entry.name) || isLeleAgentFile(entry.name))) await collectFile(full, out);
  }
}

function isLeleAgentFile(name: string): boolean {
  return /\.md$/i.test(name) && !/^(README|SKILL|CHANGELOG|LICENSE)\.md$/i.test(name);
}

/** lele sub-agent file; the folder (or file) name is the agent name. Parsed later by the lele exporter. */
async function readLeleAgent(file: string, name: string, out: Collector): Promise<void> {
  const text = await readText(file, out);
  if (text === undefined) return;
  if (!FRONTMATTER.test(text)) {
    out.problems.push(`${file}: not a lele agent (no --- frontmatter)`);
    return;
  }
  out.native.push({ path: file, runtime: "lele", name, document: text });
}

/** A file is a capability or an agent YAML, or a tool.yaml / SKILL.md that stands for its folder. */
async function collectFile(file: string, out: Collector): Promise<void> {
  const name = path.basename(file);
  if (name === "tool.yaml" || name === "SKILL.md") return collectDir(path.dirname(file), out);
  if (name === "AGENTS.md") return readLeleAgent(file, path.basename(path.dirname(file)), out);
  if (isLeleAgentFile(name)) return readLeleAgent(file, name.replace(/\.md$/i, ""), out);
  if (!YAML_FILE.test(name)) {
    out.problems.push(`${file}: not a bundle item; expected a .yaml file, tool.yaml or SKILL.md`);
    return;
  }
  const text = await readText(file, out);
  if (text === undefined) return;
  const parsed = parseYaml(text, file, out);
  if (!parsed) return;
  if (isRecord(parsed.value) && "entry" in parsed.value) return readCapability(file, parsed.value, out);
  return readAgent(file, parsed.value, out);
}

async function readTool(folder: string, out: Collector): Promise<void> {
  const file = path.join(folder, "tool.yaml");
  const text = await readText(file, out);
  if (text === undefined) return;
  const parsed = parseYaml(text, file, out);
  if (!parsed) return;
  if (!isRecord(parsed.value)) {
    out.problems.push(`${file}: expected a mapping of tool fields`);
    return;
  }

  const language = parsed.value.language;
  let code: string | undefined;
  if ((TOOL_LANGUAGES as readonly unknown[]).includes(language)) {
    const main = path.join(folder, MAIN_FILE[language as ToolLanguage]);
    code = await readText(main, out);
  }
  const result = toolSchema.safeParse({ ...parsed.value, code });
  if (!result.success) return report(out, file, result.error.issues);
  out.items.push({ kind: "tool", item: result.data });
}

async function readSkill(folder: string, out: Collector): Promise<void> {
  const file = path.join(folder, "SKILL.md");
  const text = await readText(file, out);
  if (text === undefined) return;
  const match = FRONTMATTER.exec(text);
  if (!match) {
    out.problems.push(`${file}: missing frontmatter; start with a --- block holding name and description`);
    return;
  }
  const parsed = parseYaml(match[1], file, out);
  if (!parsed) return;
  const meta = isRecord(parsed.value) ? parsed.value : {};

  const files = await supportingFiles(folder, out);
  const result = skillSchema.safeParse({ name: meta.name, description: meta.description, body: match[2], files });
  if (!result.success) return report(out, file, result.error.issues);
  out.items.push({ kind: "skill", item: result.data });
}

async function readCapability(file: string, meta: Record<string, unknown>, out: Collector): Promise<void> {
  const result = capabilitySchema.safeParse(meta);
  if (!result.success) return report(out, file, result.error.issues);
  out.items.push({ kind: "capability", item: result.data });
}

async function readAgentFile(file: string, out: Collector): Promise<void> {
  const text = await readText(file, out);
  if (text === undefined) return;
  const parsed = parseYaml(text, file, out);
  if (!parsed) return;
  return readAgent(file, parsed.value, out);
}

function readAgent(file: string, meta: unknown, out: Collector): void {
  const result = agentSpecSchema.safeParse(meta);
  if (!result.success && isGooseRecipe(meta)) {
    out.native.push({ path: file, runtime: "goose", name: path.basename(file).replace(YAML_FILE, ""), document: meta });
    return;
  }
  if (!result.success) return report(out, file, result.error.issues);
  const base =
    path.basename(file) === "agent.yaml" ? path.basename(path.dirname(file)) : path.basename(file).replace(YAML_FILE, "");
  const id = isAgentId(base) ? base : slugifyAgentId(result.data.name);
  out.agents.push({ id, spec: result.data });
}

/** A Goose recipe (or its Desktop wrapper) rather than an AgentSpec: it has a title and no name/runtime. */
function isGooseRecipe(value: unknown): boolean {
  const doc = isRecord(value) && isRecord(value.recipe) ? value.recipe : value;
  return isRecord(doc) && typeof doc.title === "string" && !("name" in doc) && !("runtime" in doc);
}

/** Every text file under a skill folder except SKILL.md and dot-files/folders; oversized or binary files are skipped. */
async function supportingFiles(folder: string, out: Collector): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile() && rel !== "SKILL.md") {
        const text = await readTextFile(full, out);
        if (text !== undefined) files[rel] = text;
      }
    }
  };
  await walk(folder, "");
  return files;
}

async function readTextFile(file: string, out: Collector): Promise<string | undefined> {
  const info = await stat(file);
  if (info.size > MAX_SUPPORTING_FILE_BYTES) return undefined;
  const bytes = await readFile(file).catch((error: unknown) => {
    out.problems.push(`${file}: cannot read (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  });
  if (!bytes || bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
