import "server-only";

import type { McpServerArgs, McpStdioArgs } from "@/core/agents/agent-spec";
import type { ToolSource } from "@/core/tools/tool-inspector.port";

/** Maps an MCP capability reference to the transport the tool inspector connects with. */
export function toToolSource(ref: McpServerArgs): ToolSource {
  if (ref.kind === "MCP") {
    const headers: Record<string, string> = { ...ref.args.headers };
    return { transport: "http", url: ref.args.url, headers, timeoutMs: (ref.args.timeout ?? 30) * 1000 };
  }

  const server = ref.args;
  const env: Record<string, string> = { ...server.env };
  for (const key of server.env_keys ?? []) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    transport: "stdio",
    command: server.command,
    args: server.args ?? [],
    env,
    cwd: server.cwd,
    timeoutMs: (server.timeout ?? 30) * 1000,
  };
}

/** Names from `env_keys` that are not set in the builder's environment, for error messages. */
export function missingEnvKeys(server: McpStdioArgs): string[] {
  return (server.env_keys ?? []).filter((key) => process.env[key] === undefined);
}
