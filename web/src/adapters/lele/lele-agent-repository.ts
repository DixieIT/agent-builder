import type { Dirent, Stats } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { isAgentId, type AgentId } from "@/core/agents/agent-id";
import { capabilityCount, leleAgentSpecSchema, type AgentSpec, type LeleAgentSpec } from "@/core/agents/agent-spec";
import type { AgentRecord, AgentRepository, AgentSummary } from "@/core/agents/agent-repository.port";
import {
  AgentConflictError,
  AgentNotFoundError,
  AgentValidationError,
  InvalidAgentDocumentError,
  InvalidAgentIdError,
  ReadOnlyAgentError,
} from "@/core/shared/errors";

import { formatLeleAgentFile, parseLeleAgentFile } from "./lele-agent-file";

/**
 * lele sub-agents as an AgentRepository. Three layers, later ones override the same name (lele's precedence):
 * bundled (read-only, shipped with lele), global (`~/.lele/agents`) and project (`<projectDir>/.lele/agents`).
 * Writes go to the project layer only. The port has no read-only flag, so writing to a bundled or global-only
 * agent throws ReadOnlyAgentError instead.
 */

export const LELE_AGENT_FILE = "AGENTS.md";

type Layer = "bundled" | "global" | "project";
/** Highest precedence first. */
const PRECEDENCE: readonly Layer[] = ["project", "global", "bundled"];

interface Definition {
  id: AgentId;
  layer: Layer;
  file: string;
}

export interface LeleAgentRepositoryOptions {
  projectDir: string;
  globalDir?: string;
  builtinDir?: string;
}

export class LeleAgentRepository implements AgentRepository {
  private readonly projectAgents: string;
  private readonly dirs: Record<Layer, string | undefined>;

  constructor(opts: LeleAgentRepositoryOptions) {
    this.projectAgents = path.join(opts.projectDir, ".lele", "agents");
    this.dirs = {
      project: this.projectAgents,
      global: opts.globalDir ?? path.join(homedir(), ".lele", "agents"),
      bundled: opts.builtinDir,
    };
  }

  async list(): Promise<AgentSummary[]> {
    const index = await this.index();
    const summaries = await Promise.all([...index].map(([id, defs]) => this.summarize(id, defs[0].file)));
    return summaries
      .filter((summary): summary is AgentSummary => summary !== undefined)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async get(id: AgentId): Promise<AgentRecord> {
    const def = (await this.index()).get(id)?.[0];
    if (!def) throw new AgentNotFoundError(id);
    const [text, stats] = await Promise.all([readFile(def.file, "utf8"), stat(def.file)]);
    return { id, spec: parseLeleAgentFile(text, id), ...timestamps(stats) };
  }

  async exists(id: AgentId): Promise<boolean> {
    return (await this.index()).has(id);
  }

  async create(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = toLeleSpec(id, spec);
    if (await this.exists(id)) throw new AgentConflictError(id);
    const file = await this.write(id, valid);
    return { id, spec: valid, ...timestamps(await stat(file)) };
  }

  async save(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = toLeleSpec(id, spec);
    const defs = (await this.index()).get(id) ?? [];
    const project = defs.find((def) => def.layer === "project");
    if (!project && defs.length > 0) throw new ReadOnlyAgentError(id, defs[0].layer);

    const previous = project ? await stat(project.file) : undefined;
    const file = await this.write(id, valid);
    const current = await stat(file);
    return { id, spec: valid, createdAt: previous ? timestamps(previous).createdAt : timestamps(current).createdAt, updatedAt: current.mtime };
  }

  async remove(id: AgentId): Promise<void> {
    const defs = (await this.index()).get(id) ?? [];
    if (defs.length === 0) throw new AgentNotFoundError(id);
    const project = defs.find((def) => def.layer === "project");
    if (!project) throw new ReadOnlyAgentError(id, defs[0].layer);
    await unlink(project.file);
    if (path.basename(project.file) === LELE_AGENT_FILE) {
      // Only an empty folder goes; anything else the user keeps there.
      await rmdir(path.dirname(project.file)).catch(() => undefined);
    }
  }

  /** Every definition per id, highest precedence first. */
  private async index(): Promise<Map<AgentId, Definition[]>> {
    const byId = new Map<AgentId, Definition[]>();
    for (const layer of PRECEDENCE) {
      for (const [id, file] of await scanLayer(this.dirs[layer])) {
        byId.set(id, [...(byId.get(id) ?? []), { id, layer, file }]);
      }
    }
    return byId;
  }

  private async write(id: AgentId, spec: LeleAgentSpec): Promise<string> {
    const file = path.join(this.projectAgents, id, LELE_AGENT_FILE);
    await writeAtomic(file, formatLeleAgentFile(spec));
    return file;
  }

  /** Summary for list(). Returns undefined when the file vanished; a bad document gets `problem` set. */
  private async summarize(id: AgentId, file: string): Promise<AgentSummary | undefined> {
    let stats: Stats;
    try {
      stats = await stat(file);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
    try {
      const spec = parseLeleAgentFile(await readFile(file, "utf8"), id);
      return {
        id,
        name: spec.name,
        description: spec.description,
        ...(spec.model ? { model: spec.model } : {}),
        capabilityCount: capabilityCount(spec),
        updatedAt: stats.mtime,
      };
    } catch (error) {
      const problem = error instanceof InvalidAgentDocumentError ? error.issues.join("; ") : messageOf(error);
      return { id, name: id, description: "", capabilityCount: 0, updatedAt: stats.mtime, problem };
    }
  }
}

/**
 * Writes a lele definition into the project layer unless that file already holds the same text.
 * The runners use it so an agent edited in the builder is visible to `lele` without touching a file that matches.
 */
export async function syncProjectDefinition(projectDir: string, name: string, definition: string): Promise<void> {
  if (!isAgentId(name)) throw new InvalidAgentIdError(name);
  const file = path.join(projectDir, ".lele", "agents", name, LELE_AGENT_FILE);
  const current = await readFile(file, "utf8").catch((error: unknown) => {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  });
  if (current === definition) return;
  await writeAtomic(file, definition);
}

/** Agents of one layer: `<dir>/<name>/AGENTS.md`, and flat `<dir>/<name>.md`, which wins over the folder form like lele. */
async function scanLayer(dir: string | undefined): Promise<Map<AgentId, string>> {
  const found = new Map<AgentId, string>();
  if (!dir) return found;

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return found;
    throw error;
  }

  const folders = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of folders) {
    const name = entry.name;
    if (!isAgentId(name)) continue;
    const file = path.join(dir, name, LELE_AGENT_FILE);
    if (await isFile(file)) found.set(name, file);
  }
  for (const entry of entries) {
    const name = entry.name;
    if (!entry.isFile() || !name.endsWith(".md") || name === LELE_AGENT_FILE) continue;
    const id = name.slice(0, -".md".length);
    if (isAgentId(id)) found.set(id, path.join(dir, name));
  }
  return found;
}

/** The spec as lele will read it: the folder name is the id, so `name` is forced to it. */
function toLeleSpec(id: AgentId, spec: AgentSpec): LeleAgentSpec {
  if (!isAgentId(id)) throw new InvalidAgentIdError(id);
  if (spec.runtime !== "lele") {
    throw new AgentValidationError([{ path: "runtime", message: `This store holds lele agents; the spec is ${spec.runtime}.`, severity: "error" }]);
  }
  const parsed = leleAgentSpecSchema.safeParse({ ...spec, name: id });
  if (!parsed.success) {
    throw new AgentValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join(".") || "(root)", message: issue.message, severity: "error" as const })),
    );
  }
  return parsed.data;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text, "utf8");
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

/** Birth time when the platform reports one, else change time. */
function timestamps(stats: Stats): Pick<AgentRecord, "createdAt" | "updatedAt"> {
  return { createdAt: stats.birthtimeMs > 0 ? stats.birthtime : stats.ctime, updatedAt: stats.mtime };
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
