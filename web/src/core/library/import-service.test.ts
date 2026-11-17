import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FsBundleCodec } from "@/adapters/bundle/fs-bundle-codec";
import { MemoryEventBus } from "@/adapters/events/memory-event-bus";
import { GooseExporter } from "@/adapters/goose/goose-exporter";
import { LeleAgentRepository } from "@/adapters/lele/lele-agent-repository";
import { LeleExporter } from "@/adapters/lele/lele-exporter";
import { createSqliteStores } from "@/adapters/sqlite";
import { AgentService } from "@/core/agents/agent-service";
import { ImportService } from "./import-service";

const EXAMPLES = path.resolve(import.meta.dir, "..", "..", "..", "..", "examples", "lele-agents");

/** Integration: real codec, real lele store, real exporters, real SQLite library. */
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "import-service-"));
  const repository = new LeleAgentRepository({ projectDir: dir });
  const stores = createSqliteStores(path.join(dir, "uab.sqlite"));
  const exporters = { goose: new GooseExporter(), lele: new LeleExporter() };
  const importer = new ImportService(new AgentService(repository, new MemoryEventBus()), repository, async () => stores.library, async (rt) => exporters[rt]);
  return { dir, repository, importer, close: () => stores.db.close() };
}

describe("ImportService", () => {
  test("imports the examples/lele-agents folder as lele agents named after their folders", async () => {
    const { dir, repository, importer, close } = await setup();
    try {
      const report = await importer.import(await new FsBundleCodec().read(EXAMPLES));
      expect(report.failed).toBe(0);
      expect(report.lines.map((l) => l.name).sort()).toEqual(["code-reviewer", "docs-writer", "task-lead", "test-writer", "web-researcher"]);

      const record = await repository.get("web-researcher" as never);
      expect(record.spec.runtime).toBe("lele");
      if (record.spec.runtime === "lele") expect(record.spec.capabilities["core.web.tool"]).toBe("active");

      const again = await importer.import(await new FsBundleCodec().read(EXAMPLES));
      expect(again.lines.every((l) => l.replaced)).toBe(true);
    } finally {
      close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dry run validates without saving", async () => {
    const { dir, repository, importer, close } = await setup();
    try {
      const report = await importer.import(await new FsBundleCodec().read(EXAMPLES), { dryRun: true });
      expect(report.failed).toBe(0);
      expect(await repository.list()).toEqual([]);
    } finally {
      close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
