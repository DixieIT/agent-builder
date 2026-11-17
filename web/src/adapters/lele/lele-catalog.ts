import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import type { Capability, CapabilityTool } from "@/core/capabilities/capability";
import type { CapabilityCatalog, RuntimeSkill } from "@/core/capabilities/capability-catalog.port";
import { RuntimeUnavailableError } from "@/core/shared/errors";
import type { JsonSchemaObject } from "@/core/tools/tool-inspector.port";

import { splitFrontMatter } from "./lele-agent-file";

/**
 * What lele offers to agents, read from lele itself: `introspect.py` boots lele's kernel and prints every mounted
 * plugin with its tools. Nothing about the tools is hardcoded here.
 * Skills come from the filesystem: the harness package, `~/.lele` and `<projectDir>/.lele` (project wins).
 */

/** Stdout marker `introspect.py` prints before its JSON. */
const MARK = "UAB-LELE-CAPABILITIES:";
const INTROSPECT_TIMEOUT_MS = 120_000;
const DEFAULT_CACHE_MS = 60_000;
const STDERR_TAIL_LINES = 5;

export interface LeleCatalogOptions {
  harnessDir: string;
  projectDir: string;
  homeDir: string;
  scriptPath: string;
  uvBin?: string;
  cacheMs?: number;
}

interface Introspection {
  capabilities: Capability[];
  floor: string[];
}

export class LeleCatalog implements CapabilityCatalog {
  readonly runtime = "lele";

  private cached?: { at: number; value: Promise<Introspection> };

  constructor(private readonly opts: LeleCatalogOptions) {}

  async capabilities(): Promise<Capability[]> {
    return (await this.introspection()).capabilities;
  }

  async grantFloor(): Promise<string[]> {
    return (await this.introspection()).floor;
  }

  private introspection(): Promise<Introspection> {
    const cacheMs = this.opts.cacheMs ?? DEFAULT_CACHE_MS;
    if (this.cached && Date.now() - this.cached.at < cacheMs) return this.cached.value;
    const value = this.introspect();
    this.cached = { at: Date.now(), value };
    // A failed run is not cached: the next call tries again.
    value.catch(() => {
      if (this.cached?.value === value) this.cached = undefined;
    });
    return value;
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
      .map((skill) => ({ ...skill, grantable: skill.source === "package" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  limitations(): string[] {
    return [
      "Deferred tools join an agent's list after `load_skill <group>`; the agent needs load-skill to load them itself.",
      "A lele sub-agent always gets bash, read-file and todo unless they are disabled.",
    ];
  }

  private async introspect(): Promise<Introspection> {
    const { harnessDir, projectDir, scriptPath, uvBin = "uv" } = this.opts;
    const { stdout, stderr } = await runLele(uvBin, [
      "run",
      "--project",
      harnessDir,
      "python",
      scriptPath,
      projectDir,
    ]);

    const line = stdout.split(/\r?\n/).find((candidate) => candidate.includes(MARK));
    if (line === undefined) {
      throw new RuntimeUnavailableError(`lele printed no capability list${stderrTail(stderr)}`);
    }
    try {
      const payload: unknown = JSON.parse(line.slice(line.indexOf(MARK) + MARK.length));
      const floor = (payload as { floor?: unknown }).floor;
      return {
        capabilities: toCapabilities(payload),
        floor: Array.isArray(floor) ? floor.filter((name): name is string => typeof name === "string") : [],
      };
    } catch {
      throw new RuntimeUnavailableError(`lele printed an unreadable capability list${stderrTail(stderr)}`);
    }
  }
}

/** Runs `uv run … introspect.py`. Resolves with stdout and stderr on exit 0, rejects with the reason otherwise. */
function runLele(uvBin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(uvBin, args, {
      shell: false,
      windowsHide: true,
      timeout: INTROSPECT_TIMEOUT_MS,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new RuntimeUnavailableError("uv not found; install uv or set UV_BIN"));
      } else {
        reject(new RuntimeUnavailableError(`could not start uv: ${error.message}`));
      }
    });
    child.on("close", (code, signal) => {
      if (signal) {
        reject(new RuntimeUnavailableError(`lele introspection was stopped (${signal}) after ${INTROSPECT_TIMEOUT_MS / 1000} s${stderrTail(stderr)}`));
      } else if (code !== 0) {
        reject(new RuntimeUnavailableError(`lele introspection exited with code ${code}${stderrTail(stderr)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function toCapabilities(payload: unknown): Capability[] {
  const plugins = recordOf(payload)?.plugins;
  if (!Array.isArray(plugins)) throw new Error("no plugins list");
  return plugins
    .map((plugin): Capability => {
      const record = recordOf(plugin);
      if (!record || typeof record.name !== "string" || !Array.isArray(record.tools)) throw new Error("malformed plugin");
      const id = record.name;
      return {
        id,
        runtime: "lele",
        description: typeof record.description === "string" ? record.description : "",
        tools: record.tools.map((tool) => toTool(tool, id)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toTool(value: unknown, plugin: string): CapabilityTool {
  const record = recordOf(value);
  if (!record || typeof record.name !== "string") throw new Error("malformed tool");
  return {
    name: record.name,
    description: typeof record.description === "string" && record.description ? record.description : undefined,
    inputSchema: (recordOf(record.parameters) ?? {}) as JsonSchemaObject,
    deferred: record.deferred === true,
    group: typeof record.group === "string" && record.group ? record.group : plugin,
  };
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

function stderrTail(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? `:\n${lines.slice(-STDERR_TAIL_LINES).join("\n")}` : "";
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

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
