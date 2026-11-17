import { describe, expect, test } from "bun:test";
import { AgentNotFoundError } from "@/core/shared/errors";
import type { AgentSystem } from "./agent-system.port";

/**
 * Contract every AgentSystem adapter must pass. Call it from the adapter's colocated test:
 *
 *   agentSystemContract("deepgen", async () => ({ system: new DeepgenAgentSystem(testDb), cleanup: () => testDb.close() }));
 *
 * The factory must return a system holding at least one agent.
 */
export function agentSystemContract(
  name: string,
  make: () => Promise<{ system: AgentSystem; cleanup?: () => Promise<void> | void }>,
  options: { timeout?: number } = {},
) {
  const timeout = options.timeout ?? 30_000;

  describe(`AgentSystem contract: ${name}`, () => {
    test(
      "info() identifies the system",
      async () => {
        const { system, cleanup } = await make();
        try {
          const info = system.info();
          expect(info.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
          expect(info.label.length).toBeGreaterThan(0);
          expect(info.kind.length).toBeGreaterThan(0);
          expect(info.location.length).toBeGreaterThan(0);
        } finally {
          await cleanup?.();
        }
      },
      timeout,
    );

    test(
      "list() returns agents whose ids describe() accepts, with consistent counts",
      async () => {
        const { system, cleanup } = await make();
        try {
          const agents = await system.list();
          expect(agents.length).toBeGreaterThan(0);
          expect(new Set(agents.map((a) => a.id)).size).toBe(agents.length);
          for (const listing of agents.filter((a) => !a.problem)) {
            const agent = await system.describe(listing.id);
            expect(agent.id).toBe(listing.id);
            expect(agent.name).toBe(listing.name);
            expect(agent.capabilities.length).toBe(listing.capabilityCount);
            expect(agent.subAgents.length).toBe(listing.subAgentCount);
          }
        } finally {
          await cleanup?.();
        }
      },
      timeout,
    );

    test(
      "capabilities are distinct and hold tools; a tool name is unique within its capability",
      async () => {
        const { system, cleanup } = await make();
        try {
          for (const listing of (await system.list()).filter((a) => !a.problem)) {
            const agent = await system.describe(listing.id);
            // Two capabilities (e.g. two MCP servers) may expose the same tool name: the capability qualifies it.
            const ids = agent.capabilities.map((view) => view.capability.id);
            expect(new Set(ids).size).toBe(ids.length);
            for (const view of agent.capabilities) {
              expect(view.capability.id.length).toBeGreaterThan(0);
              expect(view.tools.length === 0 ? Boolean(view.note || view.inspectable) : true).toBe(true);
              const names = view.tools.map(({ tool }) => tool.name);
              expect(new Set(names).size).toBe(names.length);
            }
          }
        } finally {
          await cleanup?.();
        }
      },
      timeout,
    );

    test(
      "sub-agent links point at agents of the same system",
      async () => {
        const { system, cleanup } = await make();
        try {
          const agents = await system.list();
          const ids = new Set(agents.map((a) => a.id));
          for (const listing of agents.filter((a) => !a.problem)) {
            for (const link of (await system.describe(listing.id)).subAgents) expect(ids.has(link.id)).toBe(true);
          }
        } finally {
          await cleanup?.();
        }
      },
      timeout,
    );

    test(
      "describe() of an unknown id throws AgentNotFoundError",
      async () => {
        const { system, cleanup } = await make();
        try {
          await expect(system.describe("no-such-agent-xyz")).rejects.toBeInstanceOf(AgentNotFoundError);
        } finally {
          await cleanup?.();
        }
      },
      timeout,
    );
  });
}
