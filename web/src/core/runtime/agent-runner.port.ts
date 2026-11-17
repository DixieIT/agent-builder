/** Port: run an agent on a harness and stream what happens. Adapter: Goose CLI (`goose run --recipe`). */

export interface RunRequest {
  /** Agent name as the harness knows it (Goose recipe title, lele agent folder name). */
  name: string;
  /** Harness-native definition, e.g. a Goose recipe as YAML or a lele AGENTS.md. */
  definition: string;
  /** Environment variables resolved from the environment store for this run. */
  env: Record<string, string>;
  /** Values for the template variables declared in deps_schema. */
  params: Record<string, string>;
  /** Overrides the definition's starting prompt. */
  prompt?: string;
}

export type RunEvent =
  | { type: "run.started"; runId: string; runner: string; command: string; at: string }
  | { type: "run.output"; stream: "stdout" | "stderr"; text: string }
  | { type: "run.tool"; agentId: string; name: string; args: unknown; output?: string }
  | { type: "run.finished"; exitCode: number | null; durationMs: number }
  | { type: "run.failed"; message: string };

export interface RuntimeStatus {
  runner: string;
  available: boolean;
  version?: string;
  detail: string;
}

export interface AgentRunner {
  status(): Promise<RuntimeStatus>;
  /** Yields events until the run ends or `signal` aborts (which stops the process). */
  run(request: RunRequest, signal: AbortSignal): AsyncIterable<RunEvent>;
}
