import { parseAgentId, slugifyAgentId } from "@/core/agents/agent-id";
import type { AgentRepository } from "@/core/agents/agent-repository.port";
import type { AgentService } from "@/core/agents/agent-service";
import { validateAgentSpec, type AgentSpec, type Runtime } from "@/core/agents/agent-spec";
import type { AgentExporter } from "@/core/runtime/agent-exporter.port";
import type { BundleContent } from "./bundle.port";
import type { LibraryItem } from "./library";
import type { LibraryRepository } from "./library-repository.port";

export interface ImportLine {
  /** "agent", "tool", "skill", "capability", or "file" for a file that couldn't be read. */
  kind: string;
  name: string;
  ok: boolean;
  /** Set when an existing agent or item was overwritten. */
  replaced?: boolean;
  message?: string;
  warnings?: string[];
}

export interface ImportReport {
  lines: ImportLine[];
  imported: number;
  failed: number;
  dryRun: boolean;
}

/**
 * Application service: import what a BundleCodec read (agents, library items, harness-native agent files)
 * into the agent store and the library. The CLI, the UI and the API all go through here.
 */
export class ImportService {
  constructor(
    private readonly agents: AgentService,
    private readonly repository: AgentRepository,
    private readonly library: () => Promise<LibraryRepository>,
    private readonly exporterFor: (runtime: Runtime) => Promise<AgentExporter>,
  ) {}

  async import(content: BundleContent, options: { dryRun?: boolean } = {}): Promise<ImportReport> {
    const dryRun = options.dryRun ?? false;
    const lines: ImportLine[] = (content.problems ?? []).map((problem) => ({
      kind: "file",
      name: problem.split(": ")[0],
      ok: false,
      message: problem.slice(problem.indexOf(": ") + 2) || problem,
    }));

    const agents: { id: string; spec: AgentSpec; warnings?: string[] }[] = [...content.agents];
    for (const native of content.native ?? []) {
      try {
        const { spec, warnings } = (await this.exporterFor(native.runtime)).parse(native.document);
        // A lele agent's name is its folder (or file) name, not something inside the file.
        const named = native.runtime === "lele" && spec && typeof spec === "object" ? { ...spec, name: native.name } : spec;
        const { spec: valid, issues } = validateAgentSpec(named);
        if (!valid) throw new Error(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
        agents.push({ id: native.runtime === "lele" ? native.name : slugifyAgentId(valid.name), spec: valid, warnings });
      } catch (error) {
        lines.push({ kind: "agent", name: native.name, ok: false, message: `${native.path}: ${messageOf(error)}` });
      }
    }

    const library = content.items.length && !dryRun ? await this.library() : undefined;
    for (const entry of content.items) {
      const line: ImportLine = { kind: entry.kind, name: entry.item.name, ok: true };
      if (library) {
        try {
          await save(library, entry);
        } catch (error) {
          Object.assign(line, { ok: false, message: messageOf(error) });
        }
      }
      lines.push(line);
    }

    for (const { id, spec, warnings } of agents) {
      const line: ImportLine = { kind: "agent", name: id, ok: true, warnings: warnings?.length ? warnings : undefined };
      try {
        const exists = await this.repository.exists(parseAgentId(id));
        line.replaced = exists;
        if (!dryRun) {
          const result = exists ? await this.agents.save(id, spec) : await this.agents.import(spec, id);
          const notes = result.issues.map((i) => `${i.path}: ${i.message}`);
          if (notes.length) line.warnings = [...(line.warnings ?? []), ...notes];
        }
      } catch (error) {
        Object.assign(line, { ok: false, message: messageOf(error) });
      }
      lines.push(line);
    }

    const failed = lines.filter((l) => !l.ok).length;
    return { lines, imported: lines.length - failed, failed, dryRun };
  }
}

async function save(library: LibraryRepository, entry: LibraryItem): Promise<void> {
  switch (entry.kind) {
    case "tool":
      await library.tools.save(entry.item);
      return;
    case "skill":
      await library.skills.save(entry.item);
      return;
    case "capability":
      await library.capabilities.save(entry.item);
      return;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
