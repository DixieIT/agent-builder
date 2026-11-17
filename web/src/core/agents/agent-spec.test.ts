import { describe, expect, test } from "bun:test";
import { agentSpecSchema, validateAgentSpec } from "./agent-spec";

describe("agentSpecSchema migrations", () => {
  test("a spec without runtime is a Goose agent", () => {
    const spec = agentSpecSchema.parse({ name: "a", instructions: "Hi" });
    expect(spec.runtime).toBe("goose");
  });

  test("lele grants saved under `tools` move to `capabilities`", () => {
    const spec = agentSpecSchema.parse({ runtime: "lele", name: "a", instructions: "Hi", tools: { "core.pdf": "active" } });
    expect(spec.runtime === "lele" && spec.capabilities).toEqual({ "core.pdf": "active" });
  });

  test("a stray empty `capabilities: []` next to `tools` is migrated too", () => {
    const spec = agentSpecSchema.parse({ runtime: "lele", name: "a", instructions: "Hi", capabilities: [], tools: { "write-file": "disabled" } });
    expect(spec.runtime === "lele" && spec.capabilities).toEqual({ "write-file": "disabled" });
  });

  test("lele specs reject keys lele doesn't read", () => {
    const { spec, issues } = validateAgentSpec({ runtime: "lele", name: "a", instructions: "Hi", retry: { max_retries: 1 } });
    expect(spec).toBeUndefined();
    expect(issues[0].message).toContain("retry");
  });
});
