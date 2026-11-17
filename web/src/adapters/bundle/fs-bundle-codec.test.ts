import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FsBundleCodec } from "./fs-bundle-codec";
import type { BundleContent } from "@/core/library/bundle.port";
import { agentSpecSchema } from "@/core/agents/agent-spec";
import { capabilitySchema, skillSchema, toolSchema, type LibraryItem } from "@/core/library/library";

const TOOL_CODE = "def run(**args):\n    return f\"searching {args['query']}\"\n";

function sample(): BundleContent {
  const tool = toolSchema.parse({
    name: "search_docs",
    description: "Search the internal docs.",
    instructions: "Use short queries.\nPrefer exact terms.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for." } },
      required: ["query"],
    },
    language: "python",
    code: TOOL_CODE,
    dependencies: ["requests>=2.31"],
    env_keys: ["DOCS_TOKEN"],
  });
  const skill = skillSchema.parse({
    name: "pdf-notes",
    description: "Use for PDFs: extracting notes, tables and figures.",
    body: "# PDF notes\n\nRun the extractor first.\n",
    files: { "scripts/extract.py": "print('extract')\n" },
  });
  const capability = capabilitySchema.parse({
    name: "docs-mcp",
    description: "The docs MCP server.",
    entry: { MCPStdio: { id: "docs", command: "uvx", args: ["docs-mcp"] } },
  });
  const spec = agentSpecSchema.parse({
    name: "research_assistant",
    description: "Answers questions from the docs.",
    model: "anthropic:claude-opus-5-5",
    instructions: "You help.\nBe brief.",
    capabilities: [{ MCP: { id: "remote", url: "https://mcp.example.com/mcp" } }],
  });
  const items: LibraryItem[] = [
    { kind: "tool", item: tool },
    { kind: "skill", item: skill },
    { kind: "capability", item: capability },
  ];
  return { agents: [{ id: "research-assistant", spec }], items };
}

function sorted(content: BundleContent): BundleContent {
  const key = (item: LibraryItem) => `${item.kind}:${item.item.name}`;
  return {
    agents: [...content.agents].sort((a, b) => a.id.localeCompare(b.id)),
    items: [...content.items].sort((a, b) => key(a).localeCompare(key(b))),
  };
}

describe("FsBundleCodec", () => {
  test("dump writes the folder layout with code files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bundle-dump-"));
    try {
      const written = await new FsBundleCodec().dump(dir, sample());
      const expected = [
        "agents/research-assistant/agent.yaml",
        "tools/search_docs/tool.yaml",
        "tools/search_docs/main.py",
        "tools/search_docs/requirements.txt",
        "skills/pdf-notes/SKILL.md",
        "skills/pdf-notes/scripts/extract.py",
        "capabilities/docs-mcp.yaml",
        "README.md",
      ];
      for (const rel of expected) {
        expect(written).toContain(path.join(dir, ...rel.split("/")));
        expect((await stat(path.join(dir, ...rel.split("/")))).isFile()).toBe(true);
      }
      expect(await readFile(path.join(dir, "tools/search_docs/main.py"), "utf8")).toBe(TOOL_CODE);
      expect(await readFile(path.join(dir, "tools/search_docs/requirements.txt"), "utf8")).toBe("requests>=2.31\n");
      const toolYaml = await readFile(path.join(dir, "tools/search_docs/tool.yaml"), "utf8");
      expect(toolYaml).not.toContain("code:");
      expect(toolYaml).toContain("DOCS_TOKEN");
      const skillMd = await readFile(path.join(dir, "skills/pdf-notes/SKILL.md"), "utf8");
      expect(skillMd.startsWith("---\nname: pdf-notes\n")).toBe(true);
      expect(skillMd).toContain("# PDF notes");
      expect(await readFile(path.join(dir, "README.md"), "utf8")).toContain("bun run agents import <path>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("dump rejects supporting files that escape the skill folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bundle-escape-"));
    try {
      const skill = skillSchema.parse({
        name: "bad",
        description: "Escapes.",
        body: "x",
        files: { "../outside.txt": "nope" },
      });
      await expect(new FsBundleCodec().dump(dir, { agents: [], items: [{ kind: "skill", item: skill }] })).rejects.toThrow(
        /supporting file/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("read round-trips every item alone and the whole dump root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bundle-roundtrip-"));
    try {
      const codec = new FsBundleCodec();
      const content = sample();
      await codec.dump(dir, content);

      const tool = await codec.read(path.join(dir, "tools", "search_docs"));
      expect(tool.items).toEqual([content.items[0]]);
      expect(tool.agents).toEqual([]);

      const skill = await codec.read(path.join(dir, "skills", "pdf-notes"));
      expect(skill.items).toEqual([content.items[1]]);
      expect(Object.keys((skill.items[0] as { item: { files: object } }).item.files)).toEqual(["scripts/extract.py"]);

      const capability = await codec.read(path.join(dir, "capabilities", "docs-mcp.yaml"));
      expect(capability.items).toEqual([content.items[2]]);

      const agentFolder = await codec.read(path.join(dir, "agents", "research-assistant"));
      expect(agentFolder).toEqual({ agents: content.agents, items: [] });
      const agentFile = await codec.read(path.join(dir, "agents", "research-assistant", "agent.yaml"));
      expect(agentFile).toEqual({ agents: content.agents, items: [] });

      const root = await codec.read(dir);
      expect(sorted(root)).toEqual(sorted(content));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("read reports invalid items with path and issue", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bundle-invalid-"));
    try {
      const codec = new FsBundleCodec();
      await codec.dump(dir, sample());
      await Bun.write(path.join(dir, "tools", "search_docs", "tool.yaml"), "name: search_docs\nlanguage: cobol\n");
      const error = await codec.read(path.join(dir, "tools", "search_docs")).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("tool.yaml: language");
      expect(message).toContain("tool.yaml: description");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
