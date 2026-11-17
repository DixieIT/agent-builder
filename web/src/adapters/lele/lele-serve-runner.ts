
import { isAgentId } from "@/core/agents/agent-id";
import type { AgentRunner, RunEvent, RunRequest, RuntimeStatus } from "@/core/runtime/agent-runner.port";

import { syncProjectDefinition } from "./lele-agent-repository";

const RUNNER = "lele-serve";
const HEALTH_TIMEOUT_MS = 3_000;
const DEFAULT_TASK = "Start.";
const ENV_NOTE = "Environment variables are not sent with runs over lele serve; a run uses the server's own environment.";

/**
 * Runs lele sub-agents through a running `lele serve`: POST /run, then the job's SSE stream.
 * Only the root agent's text is streamed as output; tool calls of every agent are reported as run.tool.
 */
export class LeleServeRunner implements AgentRunner {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly projectDir: string,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  async status(): Promise<RuntimeStatus> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    } catch (error) {
      return {
        runner: RUNNER,
        available: false,
        detail: `lele serve does not answer at ${this.base} (${messageOf(error)}). Start it with \`lele serve --port <port>\`.`,
      };
    }
    if (!response.ok) {
      return { runner: RUNNER, available: false, detail: `GET ${this.base}/health answered ${response.status}.` };
    }
    const health: unknown = await response.json().catch(() => undefined);
    const counts = isRecord(health)
      ? ["tools", "plugins", "extensions", "skills"].map((key) => `${stringList(health[key]).length} ${key}`).join(", ")
      : "unknown contents";
    return { runner: RUNNER, available: true, detail: `lele serve at ${this.base} (${counts}). ${ENV_NOTE}` };
  }

  async *run(request: RunRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const startedAt = Date.now();
    let jobId: string | undefined;
    let onAbort: (() => void) | undefined;

    try {
      if (!isAgentId(request.name)) throw new Error(`"${request.name}" is not a valid lele agent name.`);
      await syncProjectDefinition(this.projectDir, request.name, request.definition);

      const posted = await fetch(`${this.base}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ task: request.prompt || DEFAULT_TASK, agent: request.name, cwd: this.projectDir }),
        signal,
      });
      if (!posted.ok) {
        yield { type: "run.failed", message: `lele serve refused the run (${posted.status}): ${await posted.text()}` };
        return;
      }
      const started: unknown = await posted.json();
      if (!isRecord(started) || typeof started.job_id !== "string") {
        yield { type: "run.failed", message: "lele serve answered /run without a job_id." };
        return;
      }
      jobId = started.job_id;
      const streamPath = typeof started.stream === "string" ? started.stream : `/jobs/${jobId}/stream`;
      yield {
        type: "run.started",
        runId: jobId,
        runner: RUNNER,
        command: `POST ${this.base}/run agent=${request.name}`,
        at: new Date().toISOString(),
      };

      const cancel = (): void => {
        void fetch(`${this.base}/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => undefined);
      };
      onAbort = cancel;
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });

      const stream = await fetch(new URL(streamPath, `${this.base}/`), { headers: { accept: "text/event-stream" }, signal });
      if (!stream.ok || !stream.body) {
        yield { type: "run.failed", message: `lele serve refused the event stream (${stream.status}).` };
        return;
      }

      let rootId: string | undefined;
      let rootStreamed = false;
      const isRoot = (agentId: string): boolean => (rootId === undefined ? agentId === "main" : agentId === rootId);

      for await (const raw of sseEvents(stream.body)) {
        if (!isRecord(raw) || typeof raw.type !== "string") continue;
        const agentId = typeof raw.agent_id === "string" ? raw.agent_id : "";
        switch (raw.type) {
          case "agent_started":
            if (rootId === undefined && (raw.parent_id === null || raw.parent_id === undefined)) rootId = agentId;
            break;
          case "token":
            if (isRoot(agentId) && typeof raw.text === "string" && raw.text) {
              rootStreamed = true;
              yield { type: "run.output", stream: "stdout", text: raw.text };
            }
            break;
          case "tool_started":
            yield { type: "run.tool", agentId, name: String(raw.name ?? ""), args: raw.args };
            break;
          case "tool_finished":
            yield {
              type: "run.tool",
              agentId,
              name: String(raw.name ?? ""),
              args: raw.args,
              output: typeof raw.output === "string" ? raw.output : JSON.stringify(raw.output ?? null),
            };
            break;
          case "agent_finished":
            // Without streamed tokens the final answer would be lost; print it once instead.
            if (isRoot(agentId) && !rootStreamed && typeof raw.result === "string" && raw.result) {
              yield { type: "run.output", stream: "stdout", text: raw.result };
            }
            break;
          case "job_finished":
            yield { type: "run.finished", exitCode: 0, durationMs: Date.now() - startedAt };
            return;
          case "job_failed":
            yield { type: "run.failed", message: typeof raw.error === "string" ? raw.error : "lele serve reported a failed job." };
            return;
          default:
            break;
        }
      }

      if (signal.aborted) {
        yield { type: "run.finished", exitCode: null, durationMs: Date.now() - startedAt };
      } else {
        yield { type: "run.failed", message: "lele serve closed the event stream before the job finished." };
      }
    } catch (error) {
      if (signal.aborted) {
        yield { type: "run.finished", exitCode: null, durationMs: Date.now() - startedAt };
      } else {
        yield { type: "run.failed", message: messageOf(error) };
      }
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }
}

/** Parses `data: {json}` frames. Comment lines (":") and frames without data are skipped. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) {
          const parsed = parseJson(data);
          if (parsed !== undefined) yield parsed;
        }
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
