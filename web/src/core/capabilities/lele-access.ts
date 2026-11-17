import type { LeleGrant } from "@/core/agents/agent-spec";
import type { Capability, CapabilityTool } from "./capability";

/**
 * What a lele sub-agent can call, computed exactly as lele does (packages/plugins `schemas` and
 * core/tools `build_agent_tools`):
 *   only  = grants marked active ∪ AGENT_FLOOR
 *   minus = grants marked disabled
 *   a tool is in when its name, its group or its plugin is in `only`, unless its name is in `minus`,
 *   or its group/plugin is in `minus` and its name is not in `only` (the more specific grant wins).
 * Deferred tools that pass are on demand: they join after `load_skill <group>`.
 * A grant marked `available` (or anything else) grants nothing.
 */

/** lele's `_AGENT_FLOOR` (core/tools). The catalog reads the live value from lele; this is the fallback. */
export const LELE_AGENT_FLOOR: readonly string[] = ["bash", "read-file", "todo"];

export type Grants = Record<string, LeleGrant>;
export type ToolAccess = "granted" | "on-demand" | "denied";

function sets(grants: Grants, floor: readonly string[]) {
  const only = new Set(floor);
  const minus = new Set<string>();
  for (const [name, grant] of Object.entries(grants)) {
    if (grant === "active") only.add(name);
    else if (grant === "disabled") minus.add(name);
  }
  return { only, minus };
}

export function toolAccess(capability: Capability, tool: CapabilityTool, grants: Grants, floor: readonly string[] = LELE_AGENT_FLOOR): ToolAccess {
  const { only, minus } = sets(grants, floor);
  const byName = only.has(tool.name);
  const byGroup = only.has(tool.group) || only.has(capability.id);
  if (!byName && !byGroup) return "denied";
  const droppedByName = minus.has(tool.name);
  const droppedByGroup = minus.has(tool.group) || minus.has(capability.id);
  if (droppedByName || (droppedByGroup && !byName)) return "denied";
  return tool.deferred ? "on-demand" : "granted";
}

/** "all" when every tool is reachable (granted or on demand), "some", or "none". */
export function capabilityAccess(capability: Capability, grants: Grants, floor: readonly string[] = LELE_AGENT_FLOOR): "all" | "some" | "none" {
  const reachable = capability.tools.filter((tool) => toolAccess(capability, tool, grants, floor) !== "denied").length;
  if (reachable === 0) return "none";
  return reachable === capability.tools.length ? "all" : "some";
}

/** Grants the whole capability by its plugin name and drops grants it makes redundant or that would block it. */
export function grantCapability(grants: Grants, capability: Capability): Grants {
  const next = { ...grants };
  for (const tool of capability.tools) {
    for (const key of [tool.name, tool.group]) if (key !== capability.id && key in next) delete next[key];
  }
  next[capability.id] = "active";
  return next;
}

/**
 * Removes the capability: its plugin grant and the finer grants of its tools go, and floor groups it contains
 * (bash, read-file, todo) are disabled explicitly, because lele grants those to every agent otherwise.
 */
export function revokeCapability(grants: Grants, capability: Capability, floor: readonly string[] = LELE_AGENT_FLOOR): Grants {
  const next = { ...grants };
  delete next[capability.id];
  for (const tool of capability.tools) {
    delete next[tool.name];
    if (tool.group !== capability.id) delete next[tool.group];
  }
  for (const group of new Set(capability.tools.map((tool) => tool.group))) {
    if (floor.includes(group)) next[group] = "disabled";
  }
  return next;
}

/**
 * Rewrites grants into the fewest, least specific grants that give exactly the same access:
 * a whole capability becomes `<plugin>: active`, then groups, then single tools only for the exceptions.
 * Redundant and contradictory grants disappear (`write-file: disabled` + `write_file: active` -> `write-file: active`).
 * Keys in `preserve` (e.g. skill names, which also force-load a skill) and keys no capability knows are kept as written.
 */
export function normalizeGrants(
  grants: Grants,
  capabilities: Capability[],
  floor: readonly string[] = LELE_AGENT_FLOOR,
  preserve: ReadonlySet<string> = new Set(),
): Grants {
  const capabilityKeys = new Set(capabilities.flatMap((c) => [c.id, ...c.tools.flatMap((t) => [t.name, t.group])]));
  const wanted = new Map<CapabilityTool, boolean>();
  for (const c of capabilities) for (const t of c.tools) wanted.set(t, toolAccess(c, t, grants, floor) !== "denied");

  const next: Grants = {};
  for (const [key, grant] of Object.entries(grants)) if (preserve.has(key) || !capabilityKeys.has(key)) next[key] = grant;

  for (const c of capabilities) {
    const has = (t: CapabilityTool) => toolAccess(c, t, next, floor) !== "denied";
    const want = (t: CapabilityTool) => wanted.get(t) ?? false;
    if (c.tools.every(want) && !c.tools.every(has)) next[c.id] = "active";
    for (const group of new Set(c.tools.map((t) => t.group))) {
      if (group === c.id || preserve.has(group)) continue;
      const tools = c.tools.filter((t) => t.group === group);
      if (tools.every(want) && !tools.every(has)) next[group] = "active";
      else if (!tools.some(want) && tools.some(has)) next[group] = "disabled";
    }
    for (const t of c.tools) if (want(t) !== has(t)) next[t.name] = want(t) ? "active" : "disabled";
  }
  return next;
}

/** Turns one tool on or off with the most specific grant (its name), then drops grants that became redundant. */
export function setToolAccess(grants: Grants, capability: Capability, tool: CapabilityTool, on: boolean, floor: readonly string[] = LELE_AGENT_FLOOR): Grants {
  const next = { ...grants };
  delete next[tool.name];
  const inheritsOn = toolAccess(capability, tool, next, floor) !== "denied";
  if (on !== inheritsOn) next[tool.name] = on ? "active" : "disabled";
  return next;
}
