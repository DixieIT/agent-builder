import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { removeDir } from "./remove-dir";
import os from "node:os";
import path from "node:path";

import { type AgentId } from "@/core/agents/agent-id";
import { agentSpecSchema, type AgentSpec } from "@/core/agents/agent-spec";
import { AgentConflictError, AgentNotFoundError, EnvironmentStoreError, LibraryItemNotFoundError } from "@/core/shared/errors";
import type { Skill, Tool } from "@/core/library/library";
import { createSqliteStores, type SqliteStores } from ".";

const file = path.join(os.tmpdir(), `uab-sqlite-${randomUUID()}`, "store.db");
const id = (value: string) => value as AgentId;

const spec = (name: string, instructions: string): AgentSpec =>
  agentSpecSchema.parse({ runtime: "goose", name, description: "", instructions, capabilities: [] });

const tool: Tool = {
  name: "lookup",
  description: "Find a record by query.",
  instructions: "",
  input_schema: { type: "object", properties: { q: { type: "string", description: "Query" } }, required: ["q"] },
  deferred: false,
  language: "python",
  code: "def run(**args):\n    return 'ok'",
  dependencies: [],
  env_keys: [],
};

const skill: Skill = { name: "summarise", description: "Summarise text.", body: "# Summarise\n\nBe brief.", files: {} };

describe("sqlite adapter", () => {
  let stores: SqliteStores;
  let plain: SqliteStores;

  beforeAll(() => {
    stores = createSqliteStores(file, "test-secret");
    plain = createSqliteStores(file);
  });

  afterAll(async () => {
    stores.db.close();
    plain.db.close();
    await removeDir(path.dirname(file));
  });

  test("agents: create, get, list, save, conflict and remove", async () => {
    const created = await stores.agents.create(id("research"), spec("research", "Research things."));
    expect(created.spec.name).toBe("research");
    await expect(stores.agents.create(id("research"), spec("research", "Again."))).rejects.toThrow(AgentConflictError);

    const fetched = await stores.agents.get(id("research"));
    expect(fetched.spec).toEqual(created.spec);
    expect(await stores.agents.exists(id("research"))).toBe(true);

    const listed = await stores.agents.list();
    expect(listed.map((summary) => summary.id)).toEqual([id("research")]);
    expect(listed[0].capabilityCount).toBe(0);

    const saved = await stores.agents.save(id("research"), spec("research", "Updated instructions."));
    expect(saved.createdAt.getTime()).toBe(created.createdAt.getTime());
    expect((await stores.agents.get(id("research"))).spec.instructions).toBe("Updated instructions.");

    await stores.agents.remove(id("research"));
    await expect(stores.agents.get(id("research"))).rejects.toThrow(AgentNotFoundError);
    await expect(stores.agents.remove(id("research"))).rejects.toThrow(AgentNotFoundError);
  });

  test("agents: a bad stored document is listed with a problem and verify reports it", async () => {
    stores.db.run(
      "INSERT INTO agents (id, spec, created_at, updated_at) VALUES (?, ?, ?, ?)",
      "broken",
      "{not json",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const listed = await stores.agents.list();
    expect(listed.find((summary) => summary.id === "broken")?.problem).toContain("invalid JSON");
    const documents = (await stores.agents.verify()).find((check) => check.name === "documents");
    expect(documents?.ok).toBe(false);
    stores.db.run("DELETE FROM agents WHERE id = ?", "broken");
  });

  test("tools and skills: save, get, list and remove", async () => {
    await stores.library.tools.save(tool);
    expect((await stores.library.tools.get("lookup")).item).toEqual(tool);
    expect((await stores.library.tools.list()).map((record) => record.item.name)).toEqual(["lookup"]);

    await stores.library.skills.save(skill);
    expect((await stores.library.skills.get("summarise")).item).toEqual(skill);
    expect((await stores.library.skills.list()).length).toBe(1);

    await stores.library.tools.remove("lookup");
    await expect(stores.library.tools.get("lookup")).rejects.toThrow(LibraryItemNotFoundError);
    await expect(stores.library.tools.remove("lookup")).rejects.toThrow(LibraryItemNotFoundError);
    // Kinds are separate namespaces: the skill survives the tool's removal.
    expect((await stores.library.skills.get("summarise")).item.name).toBe("summarise");
  });

  test("environment: set stores encrypted values, list masks them, resolve decrypts", async () => {
    await stores.environment.set({
      key: "ANTHROPIC_API_KEY",
      value: "sk-test-1234567890",
      environments: ["development"],
      sensitive: true,
    });
    await stores.environment.set({
      key: "LOG_LEVEL",
      value: "debug",
      environments: ["development", "production"],
      sensitive: false,
      comment: "verbosity",
    });

    const listed = await stores.environment.list();
    const secret = listed.find((variable) => variable.key === "ANTHROPIC_API_KEY");
    const level = listed.find((variable) => variable.key === "LOG_LEVEL");
    expect(secret?.value).toBeUndefined();
    expect(secret?.preview).toBe("sk-…7890");
    expect(level?.value).toBe("debug");
    expect(level?.comment).toBe("verbosity");

    const raw = stores.db.get<{ value_enc: string }>("SELECT value_enc FROM env_vars WHERE key = ?", "ANTHROPIC_API_KEY");
    expect(raw?.value_enc).not.toContain("sk-test");

    const resolved = await stores.environment.resolve("development", ["ANTHROPIC_API_KEY", "LOG_LEVEL", "MISSING"]);
    expect(resolved.values).toEqual({ ANTHROPIC_API_KEY: "sk-test-1234567890", LOG_LEVEL: "debug" });
    expect(resolved.missing).toEqual(["MISSING"]);

    const preview = await stores.environment.resolve("preview", ["ANTHROPIC_API_KEY"]);
    expect(preview.missing).toEqual(["ANTHROPIC_API_KEY"]);

    await stores.environment.remove("LOG_LEVEL");
    expect((await stores.environment.list()).map((variable) => variable.key)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  test("environment: without UAB_SECRET_KEY the store is read-only", async () => {
    expect(plain.environment.describe().writable).toBe(false);
    expect(stores.environment.describe().writable).toBe(true);

    await expect(
      plain.environment.set({ key: "OTHER", value: "x", environments: ["development"], sensitive: true }),
    ).rejects.toThrow("Set UAB_SECRET_KEY to store secrets in the built-in store.");
    await expect(plain.environment.set({ key: "OTHER", value: "x", environments: ["development"], sensitive: true })).rejects.toBeInstanceOf(
      EnvironmentStoreError,
    );

    const listed = await plain.environment.list();
    expect(listed.map((variable) => variable.key)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(listed[0].value).toBeUndefined();
    await expect(plain.environment.resolve("development", ["ANTHROPIC_API_KEY"])).rejects.toThrow(EnvironmentStoreError);
  });
});
