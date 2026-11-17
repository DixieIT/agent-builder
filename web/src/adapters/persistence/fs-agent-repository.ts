import "server-only";

import type { Stats } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";

import { isAgentId, type AgentId } from "@/core/agents/agent-id";
import { agentSpecSchema, type AgentSpec } from "@/core/agents/agent-spec";
import type { AgentRecord, AgentRepository, AgentSummary } from "@/core/agents/agent-repository.port";
import {
  AgentConflictError,
  AgentNotFoundError,
  InvalidAgentDocumentError,
  InvalidAgentIdError,
} from "@/core/shared/errors";

/** Top-level keys in the order they are written. Extra keys follow in insertion order. */
const KEY_ORDER = [
  "name",
  "description",
  "model",
  "instructions",
  "prompt",
  "model_settings",
  "capabilities",
  "deps_schema",
  "output_schema",
  "retries",
  "end_strategy",
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(KEY_ORDER);

/** Known keys written even when empty. Every other known key is dropped when it is "". */
const ALWAYS_WRITTEN: ReadonlySet<string> = new Set<string>(["name", "description", "capabilities"]);

const EXTENSIONS: readonly string[] = [".yaml", ".yml"];

const YAML_OPTIONS = { lineWidth: 0, blockQuote: "literal" } as const;

/** One YAML file per agent: `<dir>/<id>.yaml`. Writes are atomic (temp file + rename). */
export class FsAgentRepository implements AgentRepository {
  constructor(private readonly dir: string) {}

  async list(): Promise<AgentSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }

    // Sorted names put "<id>.yaml" before "<id>.yml", so the first file seen for an id wins.
    const seen = new Set<string>();
    const candidates: { id: AgentId; file: string }[] = [];
    for (const name of [...names].sort()) {
      const ext = path.extname(name);
      if (!EXTENSIONS.includes(ext)) continue;
      const id = path.basename(name, ext);
      if (!isAgentId(id) || seen.has(id)) continue;
      seen.add(id);
      candidates.push({ id, file: path.join(this.dir, name) });
    }

    const summaries = await Promise.all(candidates.map(({ id, file }) => this.summarize(id, file)));
    return summaries
      .filter((summary): summary is AgentSummary => summary !== undefined)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async get(id: AgentId): Promise<AgentRecord> {
    const { text, stats } = await this.read(id);
    return { id, spec: parseSpec(id, text), ...timestamps(stats) };
  }

  async exists(id: AgentId): Promise<boolean> {
    try {
      await stat(this.fileOf(id));
      return true;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return false;
      throw error;
    }
  }

  async create(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = agentSpecSchema.parse(spec);
    const yaml = toYaml(valid);
    await this.ensureDir();
    const file = this.fileOf(id);
    try {
      await writeFile(file, yaml, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (isErrno(error, "EEXIST")) throw new AgentConflictError(id);
      throw error;
    }
    return { id, spec: valid, ...timestamps(await stat(file)) };
  }

  async save(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const valid = agentSpecSchema.parse(spec);
    const yaml = toYaml(valid);
    await this.ensureDir();
    const file = this.fileOf(id);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, yaml, "utf8");
    try {
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
    return { id, spec: valid, ...timestamps(await stat(file)) };
  }

  async remove(id: AgentId): Promise<void> {
    try {
      await unlink(this.fileOf(id));
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new AgentNotFoundError(id);
      throw error;
    }
  }

  private fileOf(id: AgentId): string {
    if (!isAgentId(id)) throw new InvalidAgentIdError(id);
    return path.join(this.dir, `${id}.yaml`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private async read(id: AgentId): Promise<{ text: string; stats: Stats }> {
    const file = this.fileOf(id);
    try {
      const [text, stats] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      return { text, stats };
    } catch (error) {
      if (isErrno(error, "ENOENT")) throw new AgentNotFoundError(id);
      throw error;
    }
  }

  /** Summary for list(). Returns undefined when the file vanished; never throws for a bad document. */
  private async summarize(id: AgentId, file: string): Promise<AgentSummary | undefined> {
    let stats: Stats;
    try {
      stats = await stat(file);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
    const updatedAt = stats.mtime;

    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      return problemSummary(id, updatedAt, messageOf(error));
    }

    try {
      const spec = parseSpec(id, text);
      return {
        id,
        name: spec.name,
        description: spec.description,
        ...(spec.model ? { model: spec.model } : {}),
        capabilityCount: spec.capabilities.length,
        updatedAt,
      };
    } catch (error) {
      const problem = error instanceof InvalidAgentDocumentError ? error.issues.join("; ") : messageOf(error);
      return problemSummary(id, updatedAt, problem);
    }
  }
}

function problemSummary(id: AgentId, updatedAt: Date, problem: string): AgentSummary {
  return { id, name: id, description: "", capabilityCount: 0, updatedAt, problem };
}

/** Parses and validates a stored document. Throws InvalidAgentDocumentError. */
function parseSpec(id: string, text: string): AgentSpec {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new InvalidAgentDocumentError(id, [`(root): invalid YAML: ${messageOf(error)}`], text);
  }
  const parsed = agentSpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidAgentDocumentError(id, parsed.error.issues.map(issueText), text);
  }
  return parsed.data;
}

function toYaml(spec: AgentSpec): string {
  const source: Record<string, unknown> = spec;
  const extraKeys = Object.keys(source).filter((key) => !KNOWN_KEYS.has(key));
  const doc: Record<string, unknown> = {};
  for (const key of [...KEY_ORDER, ...extraKeys]) {
    const value = source[key];
    if (value === undefined) continue;
    if (value === "" && KNOWN_KEYS.has(key) && !ALWAYS_WRITTEN.has(key)) continue;
    doc[key] = value;
  }
  return stringify(doc, YAML_OPTIONS);
}

/** Birth time when the platform reports one, else change time. */
function timestamps(stats: Stats): Pick<AgentRecord, "createdAt" | "updatedAt"> {
  return {
    createdAt: stats.birthtimeMs > 0 ? stats.birthtime : stats.ctime,
    updatedAt: stats.mtime,
  };
}

function issueText(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
