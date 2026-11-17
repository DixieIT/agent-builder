import "server-only";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  InspectionResult,
  JsonSchemaObject,
  ToolDescriptor,
  ToolInspector,
  ToolSource,
} from "@/core/tools/tool-inspector.port";

const MAX_STDERR = 4_000;

/** Adapter: connects to a real MCP server, runs initialize + tools/list, then disconnects. */
export class McpToolInspector implements ToolInspector {
  async inspect(source: ToolSource): Promise<InspectionResult> {
    const started = Date.now();
    let stderr = "";
    const client = new Client({ name: "ultimate-agent-builder-inspector", version: "0.1.0" });

    let transport: Transport;
    if (source.transport === "stdio") {
      const stdio = new StdioClientTransport({
        command: source.command,
        args: source.args,
        env: { ...getDefaultEnvironment(), ...source.env },
        cwd: source.cwd,
        stderr: "pipe",
      });
      stdio.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR) stderr += chunk.toString();
      });
      transport = stdio;
    } else {
      transport = new StreamableHTTPClientTransport(new URL(source.url), {
        requestInit: { headers: source.headers },
      });
    }

    try {
      await withTimeout(client.connect(transport, { timeout: source.timeoutMs }), source.timeoutMs, "connect");
      const tools: ToolDescriptor[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: source.timeoutMs });
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            title: tool.title ?? tool.annotations?.title,
            description: tool.description,
            inputSchema: tool.inputSchema as JsonSchemaObject,
            annotations: tool.annotations,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);

      const version = client.getServerVersion();
      return {
        status: "ok",
        server: { name: version?.name ?? "unknown", version: version?.version ?? "unknown" },
        instructions: client.getInstructions(),
        tools,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        status: "error",
        message: describe(error, source),
        stderr: stderr.trim() || undefined,
        durationMs: Date.now() - started,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms during ${step}.`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });
}

function describe(error: unknown, source: ToolSource): string {
  const message = error instanceof Error ? error.message : String(error);
  if (source.transport === "stdio" && /ENOENT/.test(message)) {
    return `Command "${source.command}" was not found. Install it or put it on PATH, then inspect again.`;
  }
  if (source.transport === "http" && /fetch failed|ECONNREFUSED/.test(message)) {
    return `Could not reach ${source.url}. Check that the server is running and the URL is right.`;
  }
  return message;
}
