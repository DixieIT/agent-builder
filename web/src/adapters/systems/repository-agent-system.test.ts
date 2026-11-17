import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { GooseExporter } from "@/adapters/goose/goose-exporter";
import { LeleAgentRepository } from "@/adapters/lele/lele-agent-repository";
import { LeleCatalog } from "@/adapters/lele/lele-catalog";
import { LeleExporter } from "@/adapters/lele/lele-exporter";
import { FsAgentRepository } from "@/adapters/persistence/fs-agent-repository";
import { parseAgentId } from "@/core/agents/agent-id";
import { agentSystemContract } from "@/core/systems/agent-system.contract";
import { RepositoryAgentSystem } from "./repository-agent-system";

/** Integration with real adapters: a folder store with Goose agents, and a lele project read through lele itself. */

const HARNESS = path.resolve(import.meta.dir, "..", "..", "..", "..", "..", "lele-harness");
const exporters = { goose: new GooseExporter(), lele: new LeleExporter() };
const exporterFor = async (runtime: "goose" | "lele") => exporters[runtime];

async function gooseSystem() {
  const dir = await mkdtemp(path.join(tmpdir(), "goose-system-"));
  const repo = new FsAgentRepository(dir);
  await repo.create(parseAgentId("writer"), { runtime: "goose", name: "writer", description: "Writes", instructions: "Write.", capabilities: [] });
  await repo.create(parseAgentId("lead"), {
    runtime: "goose",
    name: "lead",
    description: "Leads",
    instructions: "Lead.",
    capabilities: [{ MCPStdio: { id: "fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] } }, { GooseExtension: { type: "builtin", name: "developer" } }],
    sub_recipes: [{ name: "writer", path: "./writer.yaml" }],
  });
  const system = new RepositoryAgentSystem({ id: "folder", label: "Folder", kind: "builder-store", location: dir, editable: true }, repo, exporterFor, async () => undefined, (id) => `/agents/${id}`);
  return { system, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function leleSystem() {
  const dir = await mkdtemp(path.join(tmpdir(), "lele-system-"));
  const repo = new LeleAgentRepository({ projectDir: dir });
  await repo.create(parseAgentId("scout"), { runtime: "lele", name: "scout", description: "Reads", instructions: "Read.", capabilities: {} });
  await repo.create(parseAgentId("boss"), { runtime: "lele", name: "boss", description: "Delegates", instructions: "Delegate.", capabilities: { "core.subagents.tools": "active", "core.pdf": "active" } });
  const catalog = new LeleCatalog({ harnessDir: HARNESS, projectDir: dir, homeDir: homedir(), scriptPath: path.resolve(import.meta.dir, "..", "lele", "introspect.py") });
  const system = new RepositoryAgentSystem({ id: "lele", label: "lele", kind: "lele", location: dir, editable: true }, repo, exporterFor, async () => catalog);
  return { system, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

agentSystemContract("builder store (Goose)", gooseSystem);
agentSystemContract("lele project", leleSystem, { timeout: 180_000 });

describe("RepositoryAgentSystem specifics", () => {
  test("Goose: MCP servers are inspectable capabilities, sub_recipes become sub-agent links", async () => {
    const { system, cleanup } = await gooseSystem();
    try {
      const lead = await system.describe("lead");
      expect(lead.capabilities.map((c) => c.capability.id)).toEqual(["fs", "developer"]);
      expect(lead.capabilities[0].inspectable).toBeDefined();
      expect(lead.subAgents).toEqual([{ id: "writer", via: "sub_recipe" }]);
      expect(lead.native?.text).toContain("title: lead");
      expect(lead.editPath).toBe("/agents/lead");
    } finally {
      await cleanup();
    }
  });

  test("lele: plugins with per-tool access; the subagent tool links to every other agent", async () => {
    const { system, cleanup } = await leleSystem();
    try {
      const boss = await system.describe("boss");
      const ids = boss.capabilities.map((c) => c.capability.id);
      expect(ids).toContain("core.pdf");
      expect(ids).toContain("core.subagents.tools");
      expect(ids).toContain("core.tools"); // floor: bash, read_file
      const pdf = boss.capabilities.find((c) => c.capability.id === "core.pdf");
      expect(pdf?.tools.every((t) => t.access === "on-demand")).toBe(true);
      expect(boss.subAgents).toEqual([{ id: "scout", via: "subagent tool" }]);
      expect((await system.describe("scout")).subAgents).toEqual([]);
    } finally {
      await cleanup();
    }
  }, 180_000);
});
