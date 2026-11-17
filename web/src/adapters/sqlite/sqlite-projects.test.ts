import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { removeDir } from "./remove-dir";
import os from "node:os";
import path from "node:path";

import { type AgentId } from "@/core/agents/agent-id";
import { agentSpecSchema, type AgentSpec } from "@/core/agents/agent-spec";
import { DEFAULT_PROJECT_ID } from "@/core/projects/project";
import { AgentNotFoundError, ProjectNotFoundError, ProjectProtectedError } from "@/core/shared/errors";
import { createSqliteStores, type SqliteStores } from ".";
import { openSqlite } from "./sqlite-db";

const dir = path.join(os.tmpdir(), `uab-projects-${randomUUID()}`);
const id = (value: string) => value as AgentId;
const spec = (name: string): AgentSpec => agentSpecSchema.parse({ runtime: "goose", name, description: "", instructions: "x", capabilities: [] });

const opened: SqliteStores[] = [];
function open(file: string): SqliteStores {
  const stores = createSqliteStores(file);
  opened.push(stores);
  return stores;
}

afterAll(async () => {
  for (const stores of opened) stores.db.close();
  await removeDir(dir);
});

describe("sqlite schema v2: projects", () => {
  test("a v1 database keeps its agents under the default project", async () => {
    const file = path.join(dir, "v1", "store.db");
    const db = openSqlite(file);
    // The v1 layout, exactly as schema version 1 created it.
    db.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (1);
      CREATE TABLE agents (id TEXT PRIMARY KEY, spec TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE library_items (kind TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT, updated_at TEXT, PRIMARY KEY(kind,name));
      CREATE TABLE env_vars (key TEXT PRIMARY KEY, value_enc TEXT NOT NULL, environments TEXT NOT NULL, sensitive INTEGER NOT NULL, comment TEXT, updated_at TEXT NOT NULL);
    `);
    const now = new Date().toISOString();
    db.run("INSERT INTO agents (id, spec, created_at, updated_at) VALUES (?, ?, ?, ?)", "legacy", JSON.stringify(spec("legacy")), now, now);
    db.close();

    const stores = open(file);
    expect((await stores.agents.get(id("legacy"))).spec.name).toBe("legacy");
    expect((await stores.projects.get(DEFAULT_PROJECT_ID)).name).toBe("Default");
    expect((await stores.projects.agents(DEFAULT_PROJECT_ID).list()).map((a) => a.id)).toEqual([id("legacy")]);
    expect(stores.db.get<{ version: number }>("SELECT MAX(version) AS version FROM schema_version")?.version).toBe(2);

    // Idempotent: opening again changes nothing.
    const again = open(file);
    expect((await again.agents.list()).length).toBe(1);
    expect(again.db.all("SELECT version FROM schema_version").length).toBe(2);
  });

  test("project CRUD: ids come from the name and stay unique", async () => {
    const stores = open(path.join(dir, "crud", "store.db"));
    const repo = stores.projects;

    const first = await repo.create({ name: "Research Lab", description: "Papers", systems: [{ kind: "fs", location: "/tmp/agents" }] });
    expect(first.id).toBe("research-lab");
    expect(first.systems).toEqual([{ kind: "fs", location: "/tmp/agents" }]);
    expect((await repo.create({ name: "Research Lab", description: "", systems: [] })).id).toBe("research-lab-2");
    expect((await repo.create({ name: "Research Lab!", description: "", systems: [] })).id).toBe("research-lab-3");
    expect((await repo.create({ name: "Default", description: "", systems: [] })).id).toBe("default-2");
    expect((await repo.create({ name: "!!!", description: "", systems: [] })).id).toBe("project");

    const updated = await repo.update("research-lab", { name: "Research", description: "Renamed", systems: [] });
    expect(updated.id).toBe("research-lab");
    expect(updated.name).toBe("Research");
    expect(updated.systems).toEqual([]);

    const ids = (await repo.list()).map((project) => project.id);
    expect(ids[0]).toBe(DEFAULT_PROJECT_ID);
    expect(ids).toContain("research-lab");

    await expect(repo.get("missing")).rejects.toThrow(ProjectNotFoundError);
    await expect(repo.update("missing", { name: "x", description: "", systems: [] })).rejects.toThrow(ProjectNotFoundError);
    expect(() => repo.agents("missing")).toThrow(ProjectNotFoundError);
  });

  test("agents are scoped to their project: the same id can live in two projects", async () => {
    const stores = open(path.join(dir, "scoped", "store.db"));
    const a = await stores.projects.create({ name: "Alpha", description: "", systems: [] });
    const b = await stores.projects.create({ name: "Beta", description: "", systems: [] });
    const alpha = stores.projects.agents(a.id);
    const beta = stores.projects.agents(b.id);

    await alpha.create(id("writer"), spec("writer"));
    await beta.create(id("writer"), spec("writer-beta"));
    await stores.agents.create(id("writer"), spec("writer-default"));

    expect((await alpha.get(id("writer"))).spec.name).toBe("writer");
    expect((await beta.get(id("writer"))).spec.name).toBe("writer-beta");
    expect((await stores.agents.get(id("writer"))).spec.name).toBe("writer-default");
    expect((await alpha.list()).map((s) => s.id)).toEqual([id("writer")]);

    await alpha.remove(id("writer"));
    await expect(alpha.get(id("writer"))).rejects.toThrow(AgentNotFoundError);
    expect((await beta.get(id("writer"))).spec.name).toBe("writer-beta");
  });

  test("removing a project removes its agents and leaves the others", async () => {
    const stores = open(path.join(dir, "remove", "store.db"));
    const doomed = await stores.projects.create({ name: "Doomed", description: "", systems: [] });
    const kept = await stores.projects.create({ name: "Kept", description: "", systems: [] });
    await stores.projects.agents(doomed.id).create(id("one"), spec("one"));
    await stores.projects.agents(kept.id).create(id("two"), spec("two"));

    await stores.projects.remove(doomed.id);
    await expect(stores.projects.get(doomed.id)).rejects.toThrow(ProjectNotFoundError);
    expect(stores.db.get("SELECT 1 AS found FROM agents WHERE project_id = ?", doomed.id)).toBeUndefined();
    expect((await stores.projects.agents(kept.id).list()).map((s) => s.id)).toEqual([id("two")]);
    await expect(stores.projects.remove(doomed.id)).rejects.toThrow(ProjectNotFoundError);
  });

  test("the default project cannot be removed", async () => {
    const stores = open(path.join(dir, "protected", "store.db"));
    await stores.agents.create(id("keep-me"), spec("keep-me"));
    await expect(stores.projects.remove(DEFAULT_PROJECT_ID)).rejects.toThrow(ProjectProtectedError);
    expect((await stores.projects.get(DEFAULT_PROJECT_ID)).id).toBe(DEFAULT_PROJECT_ID);
    expect((await stores.agents.get(id("keep-me"))).spec.name).toBe("keep-me");
  });
});

describe("sqlite settings store", () => {
  test("set, get, unset and all", () => {
    const stores = open(path.join(dir, "settings", "store.db"));
    expect(stores.settings.all()).toEqual({});
    expect(stores.settings.get("LITELLM_BASE_URL")).toBeUndefined();

    stores.settings.set("LITELLM_BASE_URL", "http://localhost:4000");
    stores.settings.set("LOG_LEVEL", "debug");
    stores.settings.set("LOG_LEVEL", "info");
    expect(stores.settings.get("LOG_LEVEL")).toBe("info");
    expect(stores.settings.all()).toEqual({ LITELLM_BASE_URL: "http://localhost:4000", LOG_LEVEL: "info" });

    stores.settings.unset("LOG_LEVEL");
    stores.settings.unset("NOT_THERE");
    expect(stores.settings.get("LOG_LEVEL")).toBeUndefined();
    expect(stores.settings.all()).toEqual({ LITELLM_BASE_URL: "http://localhost:4000" });
  });
});
