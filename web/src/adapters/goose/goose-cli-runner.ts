import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parse, stringify } from "yaml";
import type { AgentRunner, RunEvent, RunRequest, RuntimeStatus } from "@/core/runtime/agent-runner.port";

const RUNNER = "goose-cli";
const NOT_FOUND =
  "Goose CLI not found. Install it from https://block.github.io/goose/docs/getting-started/installation or set GOOSE_BIN.";
const VERSION_TIMEOUT_MS = 10_000;
const KILL_WAIT_MS = 5_000;
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;

type Json = Record<string, unknown>;

/** Runs recipes with the Goose CLI (`goose run --recipe`). The binary path comes from GOOSE_BIN. */
export class GooseCliRunner implements AgentRunner {
  constructor(private readonly bin: string) {}

  async status(): Promise<RuntimeStatus> {
    const probe = await probeCommand(this.bin, ["--version"], VERSION_TIMEOUT_MS);
    if (probe.error) {
      return { runner: RUNNER, available: false, detail: describeSpawnError(probe.error, this.bin) };
    }
    if (probe.timedOut) {
      return { runner: RUNNER, available: false, detail: `"${this.bin} --version" did not answer within 10 s.` };
    }
    const version = stripAnsi(probe.stdout).trim();
    if (probe.code !== 0 || !version) {
      return { runner: RUNNER, available: false, detail: `"${this.bin} --version" exited with code ${probe.code}.` };
    }
    return { runner: RUNNER, available: true, version, detail: `Goose CLI at ${this.bin}` };
  }

  async *run(request: RunRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const startedAt = Date.now();
    let dir: string | undefined;
    let child: ChildProcess | undefined;
    let exited: Promise<void> = Promise.resolve();
    let onAbort: (() => void) | undefined;

    try {
      dir = await mkdtemp(join(tmpdir(), "goose-run-"));
      const file = join(dir, "recipe.yaml");
      await writeFile(file, withPrompt(request.definition, request.prompt), "utf8");

      const args = buildRunArgs(file, request.params);
      const command = [this.bin, ...args].map(quoteArg).join(" ");
      yield { type: "run.started", runId: randomUUID(), runner: RUNNER, command, at: new Date().toISOString() };

      const proc = spawn(this.bin, args, {
        shell: false,
        windowsHide: true,
        env: { ...process.env, GOOSE_MODE: process.env.GOOSE_MODE ?? "auto", NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = proc;

      // Events are queued by the child's listeners and drained by this generator.
      const queue: RunEvent[] = [];
      const state: { ended: boolean; exitCode: number | null; failure?: string; wake?: () => void } = {
        ended: false,
        exitCode: null,
      };
      const notify = (): void => {
        const resume = state.wake;
        state.wake = undefined;
        resume?.();
      };
      const emit = (event: RunEvent): void => {
        queue.push(event);
        notify();
      };
      let markExited: () => void = () => undefined;
      exited = new Promise<void>((resolve) => {
        markExited = resolve;
      });
      const finish = (code: number | null): void => {
        if (state.ended) return;
        state.ended = true;
        state.exitCode = code;
        notify();
        markExited();
      };

      const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
      const pump = (stream: "stdout" | "stderr"): void => {
        proc[stream].on("data", (chunk: Buffer) => {
          const text = stripAnsi(decoders[stream].write(chunk));
          if (text) emit({ type: "run.output", stream, text });
        });
      };
      pump("stdout");
      pump("stderr");

      proc.once("error", (error: NodeJS.ErrnoException) => {
        state.failure ??= describeSpawnError(error, this.bin);
        finish(null);
      });
      proc.once("close", (code: number | null) => {
        for (const stream of ["stdout", "stderr"] as const) {
          const rest = stripAnsi(decoders[stream].end());
          if (rest) queue.push({ type: "run.output", stream, text: rest });
        }
        finish(code);
      });

      onAbort = () => killChild(proc);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });

      while (true) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (state.ended) break;
        await new Promise<void>((resolve) => {
          state.wake = resolve;
        });
      }

      if (state.failure) {
        yield { type: "run.failed", message: state.failure };
      } else {
        yield { type: "run.finished", exitCode: state.exitCode, durationMs: Date.now() - startedAt };
      }
    } catch (error) {
      yield { type: "run.failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
      if (child && child.exitCode === null && child.signalCode === null) {
        killChild(child);
        await waitFor(exited, KILL_WAIT_MS);
      }
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function buildRunArgs(file: string, params: Record<string, string>): string[] {
  const args = ["run", "--recipe", file, "--no-session"];
  for (const [key, value] of Object.entries(params)) {
    args.push("--params", `${key}=${value}`);
  }
  return args;
}

/** Overrides the recipe's starting prompt when a prompt is given. */
function withPrompt(definition: string, prompt: string | undefined): string {
  if (!prompt) return definition;
  const parsed: unknown = parse(definition);
  if (!isRecord(parsed)) throw new Error("The Goose recipe is not a YAML mapping.");
  const target = isRecord(parsed.recipe) ? parsed.recipe : parsed;
  target.prompt = prompt;
  return stringify(parsed, { lineWidth: 0, blockQuote: "literal" });
}

function probeCommand(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; code: number | null; error?: NodeJS.ErrnoException; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(bin, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
    }, timeoutMs);
    const settle = (result: { stdout: string; code: number | null; error?: NodeJS.ErrnoException; timedOut: boolean }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.once("error", (error: NodeJS.ErrnoException) => settle({ stdout, code: null, error, timedOut }));
    child.once("close", (code: number | null) => settle({ stdout, code, timedOut }));
  });
}

/** Stops the process; on Windows also its tree, since `goose` may start children. */
function killChild(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => undefined);
  }
  child.kill();
}

function waitFor(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    void promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function describeSpawnError(error: NodeJS.ErrnoException, bin: string): string {
  return error.code === "ENOENT" ? NOT_FOUND : `Could not start ${bin}: ${error.message}`;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function quoteArg(arg: string): string {
  return /\s|"/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
