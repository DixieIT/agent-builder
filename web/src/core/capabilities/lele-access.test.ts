import { describe, expect, test } from "bun:test";
import type { Capability } from "./capability";
import { capabilityAccess, grantCapability, normalizeGrants, revokeCapability, setToolAccess, toolAccess, type Grants } from "./lele-access";

/** Shapes taken from a real lele boot (profile "coding"). */
const coreTools: Capability = {
  id: "core.tools",
  runtime: "lele",
  description: "lele's own capabilities",
  tools: [
    { name: "bash", group: "bash", deferred: false },
    { name: "bash_output", group: "bash", deferred: false },
    { name: "bash_kill", group: "bash", deferred: false },
    { name: "read_file", group: "read-file", deferred: false },
    { name: "write_file", group: "write-file", deferred: false },
  ],
};
const pdf: Capability = {
  id: "core.pdf",
  runtime: "lele",
  description: "read and edit PDF files",
  tools: ["pdf_info", "pdf_read", "pdf_compose", "pdf_modify"].map((name) => ({ name, group: "pdf", deferred: true })),
};
const web: Capability = {
  id: "core.web.tool",
  runtime: "lele",
  description: "web",
  tools: [
    { name: "web_search", group: "web-search", deferred: false },
    { name: "web_fetch", group: "web-fetch", deferred: false },
  ],
};

const access = (cap: Capability, grants: Grants) => Object.fromEntries(cap.tools.map((t) => [t.name, toolAccess(cap, t, grants)]));

describe("lele tool access (mirrors plugins.schemas + build_agent_tools)", () => {
  test("floor groups are granted to every agent; the rest of the plugin is not", () => {
    expect(access(coreTools, {})).toEqual({ bash: "granted", bash_output: "granted", bash_kill: "granted", read_file: "granted", write_file: "denied" });
    expect(capabilityAccess(coreTools, {})).toBe("some");
  });

  test("a plugin grant covers all its tools; a group grant only its group", () => {
    expect(capabilityAccess(web, { "core.web.tool": "active" })).toBe("all");
    expect(access(web, { "web-search": "active" })).toEqual({ web_search: "granted", web_fetch: "denied" });
  });

  test("deferred tools are on demand when granted", () => {
    expect(access(pdf, { pdf: "active" })).toEqual({ pdf_info: "on-demand", pdf_read: "on-demand", pdf_compose: "on-demand", pdf_modify: "on-demand" });
    expect(capabilityAccess(pdf, {})).toBe("none");
  });

  test("disabled subtracts, the more specific grant wins, available grants nothing", () => {
    expect(access(coreTools, { bash: "disabled" }).bash).toBe("denied");
    expect(access(coreTools, { bash: "disabled", bash_output: "active" })).toMatchObject({ bash: "denied", bash_output: "granted" });
    expect(access(web, { "core.web.tool": "active", web_fetch: "disabled" })).toEqual({ web_search: "granted", web_fetch: "denied" });
    expect(access(web, { "core.web.tool": "available" })).toEqual({ web_search: "denied", web_fetch: "denied" });
  });
});

describe("editing grants", () => {
  test("granting a capability uses the plugin name and clears blocking finer grants", () => {
    const next = grantCapability({ "web-search": "active", web_fetch: "disabled", other: "active" }, web);
    expect(next).toEqual({ "core.web.tool": "active", other: "active" });
    expect(capabilityAccess(web, next)).toBe("all");
  });

  test("revoking a capability with floor groups disables them explicitly", () => {
    const next = revokeCapability({ "core.tools": "active" }, coreTools);
    expect(next).toEqual({ bash: "disabled", "read-file": "disabled" });
    expect(capabilityAccess(coreTools, next)).toBe("none");
    expect(revokeCapability({ "core.web.tool": "active" }, web)).toEqual({});
  });

  test("toggling one tool writes the most specific grant only when needed", () => {
    const off = setToolAccess({ "core.web.tool": "active" }, web, web.tools[1], false);
    expect(off).toEqual({ "core.web.tool": "active", web_fetch: "disabled" });
    expect(setToolAccess(off, web, web.tools[1], true)).toEqual({ "core.web.tool": "active" });
    expect(setToolAccess({}, coreTools, coreTools.tools[4], true)).toEqual({ write_file: "active" });
    expect(setToolAccess({}, coreTools, coreTools.tools[0], false)).toEqual({ bash: "disabled" });
  });
});

describe("normalizeGrants", () => {
  const edit: Capability = { id: "core.edit", runtime: "lele", description: "", tools: [{ name: "apply_patch", group: "edit-file", deferred: false }] };
  const all = [coreTools, pdf, web, edit];
  const accessOf = (grants: Grants) => Object.fromEntries(all.flatMap((c) => c.tools.map((t) => [t.name, toolAccess(c, t, grants)])));

  test("the web-researcher grants collapse to whole capabilities, with the same access", () => {
    const messy: Grants = {
      "web-search": "active",
      "web-fetch": "active",
      "write-file": "disabled",
      "edit-file": "disabled",
      "core.pdf": "active",
      write_file: "active",
    };
    const clean = normalizeGrants(messy, all);
    // bash and read_file come from the floor, so granting write_file completes core.tools.
    expect(clean).toEqual({ "core.web.tool": "active", "core.pdf": "active", "core.tools": "active" });
    expect(accessOf(clean)).toEqual(accessOf(messy));
  });

  test("removing floor tools stays explicit; untouched grants stay empty", () => {
    expect(normalizeGrants({}, all)).toEqual({});
    const noBash = normalizeGrants({ bash: "disabled", bash_output: "active" }, all);
    expect(accessOf(noBash)).toEqual(accessOf({ bash: "disabled", bash_output: "active" }));
    expect(noBash).toEqual({ bash: "disabled", bash_output: "active" });
  });

  test("skill names and unknown keys are kept as written", () => {
    const grants: Grants = { pdf: "active", "lele-docs": "active", "my-extension": "active" };
    const clean = normalizeGrants(grants, all, undefined, new Set(["pdf", "lele-docs"]));
    expect(clean).toEqual(grants);
  });

  test("any grant set normalizes to the same access (exhaustive over core.tools grants)", () => {
    const keys = ["core.tools", "bash", "read-file", "write-file", "bash_output", "write_file"];
    const states = [undefined, "active", "disabled"] as const;
    const combos = (i: number): Grants[] =>
      i === keys.length ? [{}] : combos(i + 1).flatMap((rest) => states.map((s) => (s ? { ...rest, [keys[i]]: s } : rest)));
    for (const grants of combos(0)) expect(accessOf(normalizeGrants(grants, all))).toEqual(accessOf(grants));
  });
});
