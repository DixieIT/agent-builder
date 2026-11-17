import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseAgentId } from "@/core/agents/agent-id";
import type { LeleAgentSpec } from "@/core/agents/agent-spec";
import { AgentConflictError, AgentNotFoundError, InvalidAgentDocumentError, ReadOnlyAgentError } from "@/core/shared/errors";
import { formatLeleAgentFile, parseLeleAgentFile } from "./lele-agent-file";
import { LeleAgentRepository } from "./lele-agent-repository";
import { LeleCatalog } from "./lele-catalog";
import { LeleExporter } from "./lele-exporter";

/** The real lele harness. Read-only: nothing in this file writes there. */
const HARNESS = "d:/Progetti/lele-harness";
const BUILTIN_AGENTS = path.join(HARNESS, "lele_harness", "agents");
const EXPLORE_FILE = path.join(BUILTIN_AGENTS, "explore", "AGENTS.md");

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lele-test-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function tempDirs(): Promise<{ projectDir: string; globalDir: string }> {
  const dir = await mkdtemp(path.join(root, "case-"));
  return { projectDir: path.join(dir, "project"), globalDir: path.join(dir, "global") };
}

describe("lele agent file", () => {
  test("round trip on the real bundled explore agent", async () => {
    const text = await readFile(EXPLORE_FILE, "utf8");
    const spec = parseLeleAgentFile(text, "explore");

    expect(spec.runtime).toBe("lele");
    expect(spec.name).toBe("explore");
    expect(spec.tools).toEqual({});
    expect(spec.instructions.startsWith("You are a read-only scout")).toBe(true);

    const formatted = formatLeleAgentFile(spec);
    expect(formatted.startsWith("---\n")).toBe(true);
    expect(formatted.split("---")[1]).not.toContain("runtime");
    expect(formatted).not.toMatch(/^name:/m);
    expect(parseLeleAgentFile(formatted, "explore")).toEqual(spec);
  });

  test("normalizes grants, keeps available, drops unknown states and ignores unknown keys", () => {
    const text = [
      "---",
      "description: \"  Builds things  \"",
      "model: deepseek/deepseek-v4-flash",
      "tools:",
      "  bash: active",
      "  read-file: true",
      "  write-file: disabled",
      "  edit-file: false",
      "  web-search: available",
      "  todo: \"disabled\"",
      "  lele-docs: active",
      "hidden: true",
      "simple: false",
      "colour: blue",
      "---",
      "Do the thing.",
      "",
    ].join("\n");
    const spec = parseLeleAgentFile(text, "builder");

    expect(spec.name).toBe("builder");
    expect(spec.description).toBe("Builds things");
    expect(spec.model).toBe("deepseek/deepseek-v4-flash");
    expect(spec.hidden).toBe(true);
    expect(spec.simple).toBeUndefined();
    expect(spec.instructions).toBe("Do the thing.");
    expect(spec.tools).toEqual({
      bash: "active",
      "read-file": "active",
      "write-file": "disabled",
      "edit-file": "disabled",
      todo: "disabled",
      "lele-docs": "active",
      "web-search": "available",
    });
  });

  test("a list or a legacy skills key grants every name as active", () => {
    expect(parseLeleAgentFile("---\ntools: [bash, pdf]\n---\nx", "a").tools).toEqual({ bash: "active", pdf: "active" });
    expect(parseLeleAgentFile("---\nskills: {pdf: true}\n---\nx", "a").tools).toEqual({ pdf: "active" });
    // tools wins over the legacy key when both are present.
    expect(parseLeleAgentFile("---\ntools: {bash: active}\nskills: {pdf: true}\n---\nx", "a").tools).toEqual({ bash: "active" });
  });

  test("the name key overrides the folder name, as lele does", () => {
    expect(parseLeleAgentFile("---\nname: renamed\n---\nx", "folder").name).toBe("renamed");
  });

  test("formats like lele agent create: no name, no runtime, empty values dropped", () => {
    const spec: LeleAgentSpec = { runtime: "lele", name: "demo", description: "Demo", instructions: "Do it.", tools: { bash: "active" }, hidden: false };
    expect(formatLeleAgentFile(spec)).toBe("---\ndescription: Demo\ntools:\n  bash: active\n\n---\nDo it.\n");

    const bare: LeleAgentSpec = { runtime: "lele", name: "bare", description: "", instructions: "Hi", tools: {} };
    expect(formatLeleAgentFile(bare)).toBe("---\n{}\n\n---\nHi\n");
  });

  test("invalid YAML or an invalid name throws InvalidAgentDocumentError", () => {
    expect(() => parseLeleAgentFile("---\ntools: [unclosed\n---\nx", "a")).toThrow(InvalidAgentDocumentError);
    expect(() => parseLeleAgentFile("---\nname: Not Valid!\n---\nx", "a")).toThrow(InvalidAgentDocumentError);
  });
});

describe("LeleAgentRepository", () => {
  test("CRUD in the project layer; bundled agents are listed and read-only", async () => {
    const { projectDir, globalDir } = await tempDirs();
    const repo = new LeleAgentRepository({ projectDir, globalDir, builtinDir: BUILTIN_AGENTS });
    const id = parseAgentId("reviewer");

    expect(await repo.exists(id)).toBe(false);
    const reviewer: LeleAgentSpec = {
      runtime: "lele",
      name: "reviewer",
      description: "Reviews code",
      instructions: "Review carefully.",
      tools: { "read-file": "active", bash: "active" },
    };
    const created = await repo.create(id, reviewer);
    expect(created.spec.name).toBe("reviewer");
    expect(await repo.exists(id)).toBe(true);

    const file = path.join(projectDir, ".lele", "agents", "reviewer", "AGENTS.md");
    expect(await readFile(file, "utf8")).toBe(formatLeleAgentFile(reviewer));

    await expect(repo.create(id, reviewer)).rejects.toBeInstanceOf(AgentConflictError);
    await expect(repo.create(parseAgentId("explore"), reviewer)).rejects.toBeInstanceOf(AgentConflictError);

    const updated = await repo.save(id, { ...reviewer, description: "Reviews code carefully" });
    expect(updated.spec.description).toBe("Reviews code carefully");
    expect((await repo.get(id)).spec.description).toBe("Reviews code carefully");
    expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());

    const summaries = await repo.list();
    const names: string[] = summaries.map((summary) => summary.id);
    expect(names).toContain("reviewer");
    expect(names).toContain("explore");
    const explore = summaries.find((summary) => summary.id === "explore");
    expect(explore?.name).toBe("explore");
    expect(explore?.problem).toBeUndefined();
    expect(summaries.find((summary) => summary.id === "reviewer")?.capabilityCount).toBe(2);

    await repo.remove(id);
    expect(await repo.exists(id)).toBe(false);
    await expect(repo.remove(id)).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  test("bundled and global agents cannot be saved or removed", async () => {
    const { projectDir, globalDir } = await tempDirs();
    await mkdir(path.join(globalDir, "shared"), { recursive: true });
    await writeFile(path.join(globalDir, "shared", "AGENTS.md"), "---\ndescription: Global\n---\nGlobal body.\n", "utf8");
    const repo = new LeleAgentRepository({ projectDir, globalDir, builtinDir: BUILTIN_AGENTS });

    const explore = parseAgentId("explore");
    const exploreSpec = (await repo.get(explore)).spec;
    await expect(repo.save(explore, exploreSpec)).rejects.toBeInstanceOf(ReadOnlyAgentError);
    await expect(repo.remove(explore)).rejects.toBeInstanceOf(ReadOnlyAgentError);

    const shared = parseAgentId("shared");
    await expect(repo.remove(shared)).rejects.toBeInstanceOf(ReadOnlyAgentError);
    expect((await repo.get(shared)).spec.instructions).toBe("Global body.");
  });

  test("a bad document is listed with problem set and never throws from list", async () => {
    const { projectDir, globalDir } = await tempDirs();
    const dir = path.join(projectDir, ".lele", "agents", "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "AGENTS.md"), "---\ntools: [oops\n---\nbody", "utf8");
    const repo = new LeleAgentRepository({ projectDir, globalDir });

    const summaries = await repo.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].problem).toBeDefined();
    await expect(repo.get(parseAgentId("broken"))).rejects.toBeInstanceOf(InvalidAgentDocumentError);
  });
});

describe("LeleCatalog", () => {
  test("lists the real skills of the harness; package skills that are not native groups are grantable", async () => {
    const { projectDir } = await tempDirs();
    const catalog = new LeleCatalog({ harnessDir: HARNESS, projectDir, homeDir: path.join(root, "no-home") });
    const skills = await catalog.skills();
    const byName = new Map(skills.map((skill) => [skill.name, skill]));

    const docs = byName.get("lele-docs");
    expect(docs?.source).toBe("package");
    expect(docs?.grantable).toBe(true);
    expect(docs?.description.length).toBeGreaterThan(0);

    // pdf is also a native tool group, so it can't be force-granted as a skill.
    expect(byName.get("pdf")?.grantable).toBe(false);
    // delegate and handoff hold only __pycache__: no SKILL.md, so not skills.
    expect(byName.has("delegate")).toBe(false);
  });

  test("tool groups carry the floor, the tools.yaml states and the native tools", async () => {
    const { projectDir } = await tempDirs();
    const catalog = new LeleCatalog({ harnessDir: HARNESS, projectDir, homeDir: path.join(root, "no-home") });
    const groups = await catalog.toolGroups();
    const byName = new Map(groups.map((group) => [group.name, group]));

    expect(byName.get("bash")?.defaultState).toBe("floor");
    expect(byName.get("read-file")?.defaultState).toBe("floor");
    expect(byName.get("todo")?.defaultState).toBe("floor");
    expect(byName.get("write-file")?.defaultState).toBe("active");
    expect(byName.get("pdf")?.defaultState).toBe("available");
    expect(byName.get("web-search")?.defaultState).toBe("disabled");
    expect(byName.get("bash")?.tools.map((tool) => tool.name)).toEqual(["bash", "bash_output", "bash_kill"]);
    expect(byName.get("lele-docs")?.source).toBe("skill");
    expect(catalog.limitations()).toHaveLength(3);
  });

  test("extensions and plugins come from the home and project .lele folders; project config wins", async () => {
    const home = path.join(root, "catalog-home");
    const project = path.join(root, "catalog-project");
    await mkdir(path.join(home, ".lele", "extensions", "mail"), { recursive: true });
    await writeFile(path.join(home, ".lele", "extensions", "mail", "extension.py"), "", "utf8");
    await mkdir(path.join(project, ".lele", "plugins", "goal"), { recursive: true });
    await writeFile(path.join(project, ".lele", "plugins", "goal", "plugin.py"), "", "utf8");
    await writeFile(path.join(home, ".lele", "config.yaml"), "extensions:\n  mail: disabled\n", "utf8");
    await writeFile(path.join(project, ".lele", "config.yaml"), "plugins:\n  goal: available\n", "utf8");

    const catalog = new LeleCatalog({ harnessDir: HARNESS, projectDir: project, homeDir: home });
    const groups = await catalog.toolGroups();
    const mail = groups.find((group) => group.name === "mail");
    const goal = groups.find((group) => group.name === "goal");
    expect(mail?.source).toBe("extension");
    expect(mail?.defaultState).toBe("disabled");
    expect(goal?.source).toBe("plugin");
    expect(goal?.defaultState).toBe("available");
  });
});

describe("LeleExporter", () => {
  test("export produces AGENTS.md and parse reads it back", () => {
    const exporter = new LeleExporter();
    const spec: LeleAgentSpec = { runtime: "lele", name: "demo", description: "Demo", instructions: "Do it.", tools: { bash: "active" } };
    const exported = exporter.export(spec);
    expect(exported).toEqual({
      name: "demo",
      definition: formatLeleAgentFile(spec),
      filename: "AGENTS.md",
      contentType: "text/markdown",
      warnings: [],
    });
    // AGENTS.md carries no name (the folder is the name), so parse falls back to "agent".
    expect(exporter.parse(exported.definition)).toEqual({ spec: { ...spec, name: "agent" }, warnings: [] });
    expect(() => exporter.parse(42)).toThrow();
  });

  test("export refuses a goose spec", () => {
    const exporter = new LeleExporter();
    expect(() => exporter.export({ runtime: "goose", name: "g", description: "", instructions: "x", capabilities: [] })).toThrow();
  });
});
