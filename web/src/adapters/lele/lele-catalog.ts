import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import type { RuntimeCatalog, RuntimeSkill, RuntimeTool, RuntimeToolGroup } from "@/core/runtime/runtime-catalog.port";

import { splitFrontMatter } from "./lele-agent-file";

/**
 * What lele offers to agents: native tool groups, extensions, plugins and skills.
 * Sources: the harness package (tools.yaml, bundled skills), `~/.lele` and `<projectDir>/.lele`, and
 * `lele serve` /health when a serve URL is given. Project entries win over home entries with the same name.
 */

type State = RuntimeToolGroup["defaultState"];

interface BuiltinGroup {
  name: string;
  tools: string[];
  floor?: boolean;
}

/** Native tool groups as lele's grant table defines them. bash, read-file and todo are always granted. */
const BUILTIN_GROUPS: readonly BuiltinGroup[] = [
  { name: "bash", tools: ["bash", "bash_output", "bash_kill"], floor: true },
  { name: "read-file", tools: ["read_file"], floor: true },
  { name: "todo", tools: ["todo_write"], floor: true },
  { name: "write-file", tools: ["write_file"] },
  { name: "edit-file", tools: ["apply_patch"] },
  { name: "subagent", tools: ["subagent", "subagent_fork", "send_message", "interrupt_agent", "list_agents"] },
  { name: "web-search", tools: ["web_search"] },
  { name: "web-fetch", tools: ["web_fetch"] },
  { name: "load-skill", tools: ["load_skill"] },
  { name: "pdf", tools: ["pdf_info", "pdf_read", "pdf_compose", "pdf_modify"] },
];

const NATIVE_GROUPS: ReadonlySet<string> = new Set(BUILTIN_GROUPS.map((group) => group.name));
const NATIVE_TOOLS: ReadonlySet<string> = new Set(BUILTIN_GROUPS.flatMap((group) => group.tools));

const HEALTH_TIMEOUT_MS = 2_000;

export interface LeleCatalogOptions {
  harnessDir: string;
  projectDir: string;
  homeDir: string;
  serveUrl?: string;
}

interface Health {
  tools: string[];
  plugins: string[];
  extensions: string[];
  skills: string[];
}

export class LeleCatalog implements RuntimeCatalog {
  readonly runtime = "lele";

  constructor(private readonly opts: LeleCatalogOptions) {}

  async toolGroups(): Promise<RuntimeToolGroup[]> {
    const [states, extensionDirs, pluginDirs, health] = await Promise.all([
      this.toolStates(),
      this.namedDirs("extensions", "extension.py"),
      this.namedDirs("plugins", "plugin.py"),
      this.health(),
    ]);
    const configExtensions = await this.configSection("extensions");
    const configPlugins = await this.configSection("plugins");

    const groups: RuntimeToolGroup[] = BUILTIN_GROUPS.map((group): RuntimeToolGroup => ({
      name: group.name,
      source: "builtin",
      defaultState: group.floor ? "floor" : (toState(states.get(group.name)) ?? "active"),
      tools: group.tools.map((name): RuntimeTool => ({ name })),
    }));

    // Skill entries of tools.yaml that are not native groups (e.g. lele-docs) are on-demand skills.
    for (const [name, value] of states) {
      if (NATIVE_GROUPS.has(name)) continue;
      groups.push({ name, source: "skill", defaultState: toState(value) ?? "disabled", tools: [] });
    }

    const extensionNames = sortedUnion(extensionDirs.keys(), health?.extensions ?? []);
    for (const name of extensionNames) {
      groups.push({ name, source: "extension", defaultState: toState(configExtensions.get(name)) ?? "active", tools: [] });
    }

    const pluginNames = sortedUnion(pluginDirs.keys(), health?.plugins ?? []);
    for (const name of pluginNames) {
      groups.push({ name, source: "plugin", defaultState: toState(configPlugins.get(name)) ?? "active", tools: [] });
    }

    // Native tools the running server exposes that no built-in group lists: each one is its own group.
    const known = new Set(groups.flatMap((group) => group.tools.map((tool) => tool.name)));
    for (const tool of [...new Set(health?.tools ?? [])].sort()) {
      if (NATIVE_TOOLS.has(tool) || known.has(tool)) continue;
      groups.push({ name: tool, source: "builtin", defaultState: "disabled", tools: [{ name: tool }] });
    }
    return groups;
  }

  async skills(): Promise<RuntimeSkill[]> {
    const { harnessDir, projectDir, homeDir } = this.opts;
    // Later sources win over earlier ones with the same name: project over global over package.
    const sources: { dir: string; source: RuntimeSkill["source"] }[] = [
      { dir: path.join(harnessDir, "lele_harness", "skills"), source: "package" },
      { dir: path.join(homeDir, ".lele", "skills"), source: "global" },
      { dir: path.join(homeDir, ".agents", "skills"), source: "global" },
      { dir: path.join(homeDir, ".claude", "skills"), source: "global" },
      { dir: path.join(projectDir, ".lele", "skills"), source: "project" },
      { dir: path.join(projectDir, ".agents", "skills"), source: "project" },
      { dir: path.join(projectDir, ".claude", "skills"), source: "project" },
    ];

    const byName = new Map<string, RuntimeSkill>();
    for (const { dir, source } of sources) {
      for (const skill of await scanSkills(dir, source)) byName.set(skill.name, skill);
    }
    return [...byName.values()]
      .map((skill) => ({ ...skill, grantable: skill.source === "package" && !NATIVE_GROUPS.has(skill.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  limitations(): string[] {
    return [
      "lele doesn't expose tool argument schemas; arguments are shown only for tools defined in the builder library.",
      "Deferred loading in lele works through skills (load_skill), not per agent.",
      "Per-agent skill allowlists don't exist in lele; any skill can be loaded on demand.",
    ];
  }

  /** `skills:` of the harness's tools.yaml: the default state of each name. */
  private async toolStates(): Promise<Map<string, string>> {
    const text = await readOptional(path.join(this.opts.harnessDir, "lele_harness", "tools.yaml"));
    const states = new Map<string, string>();
    if (text === undefined) return states;
    const skills = recordOf(parseYaml(text))?.skills;
    for (const [name, value] of Object.entries(recordOf(skills) ?? {})) {
      if (typeof value === "string") states.set(name, value);
    }
    return states;
  }

  /** `<section>:` of `~/.lele/config.yaml`, overridden by `<projectDir>/.lele/config.yaml`. */
  private async configSection(section: "extensions" | "plugins"): Promise<Map<string, string>> {
    const merged = new Map<string, string>();
    const files = [
      path.join(this.opts.homeDir, ".lele", "config.yaml"),
      path.join(this.opts.projectDir, ".lele", "config.yaml"),
    ];
    for (const file of files) {
      const text = await readOptional(file);
      if (text === undefined) continue;
      for (const [name, value] of Object.entries(recordOf(recordOf(parseYaml(text))?.[section]) ?? {})) {
        if (typeof value === "string") merged.set(name, value);
      }
    }
    return merged;
  }

  /** Subfolders of `<home>/.lele/<kind>` and `<project>/.lele/<kind>` that hold `marker`. Project wins. */
  private async namedDirs(kind: "extensions" | "plugins", marker: string): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const root of [this.opts.homeDir, this.opts.projectDir]) {
      const base = path.join(root, ".lele", kind);
      let entries: Dirent[];
      try {
        entries = await readdir(base, { withFileTypes: true });
      } catch (error) {
        if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) continue;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if ((await readOptional(path.join(base, entry.name, marker))) !== undefined) {
          found.set(entry.name, path.join(base, entry.name));
        }
      }
    }
    return found;
  }

  /** `lele serve` /health, or undefined when no server is configured or it does not answer. */
  private async health(): Promise<Health | undefined> {
    if (!this.opts.serveUrl) return undefined;
    try {
      const response = await fetch(`${this.opts.serveUrl.replace(/\/+$/, "")}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      const record = recordOf(body);
      if (!record) return undefined;
      return {
        tools: stringList(record.tools),
        plugins: stringList(record.plugins),
        extensions: stringList(record.extensions),
        skills: stringList(record.skills),
      };
    } catch {
      return undefined;
    }
  }
}

async function scanSkills(dir: string, source: RuntimeSkill["source"]): Promise<RuntimeSkill[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return [];
    throw error;
  }
  const skills: RuntimeSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(dir, entry.name);
    const text = await readOptional(path.join(folder, "SKILL.md"));
    if (text === undefined) continue;
    skills.push({
      name: entry.name,
      description: describeSkill(text),
      source,
      path: folder,
      grantable: false,
    });
  }
  return skills;
}

/** `description` from the front matter, else the first prose line of the body (not a heading or fence). */
function describeSkill(text: string): string {
  const { yaml, body } = splitFrontMatter(text);
  if (yaml !== undefined) {
    const description = recordOf(parseYaml(yaml))?.description;
    if (typeof description === "string" && description.trim()) return description.trim();
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("```") && !trimmed.startsWith("---")) return trimmed;
  }
  return "";
}

function parseYaml(text: string): unknown {
  try {
    return parse(text, { version: "1.1" });
  } catch {
    return undefined;
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR") || isErrno(error, "EISDIR")) return undefined;
    throw error;
  }
}

function toState(value: string | undefined): State | undefined {
  return value === "floor" || value === "active" || value === "available" || value === "disabled" ? value : undefined;
}

function sortedUnion(first: Iterable<string>, second: string[]): string[] {
  return [...new Set([...first, ...second])].sort();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
