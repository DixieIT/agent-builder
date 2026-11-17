import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import { isAgentId } from "@/core/agents/agent-id";
import type { AgentRunner, RunEvent, RunRequest, RuntimeStatus } from "@/core/runtime/agent-runner.port";

import { syncProjectDefinition } from "./lele-agent-repository";

const RUNNER = "lele-cli";
const NOT_FOUND = "lele not found; install with `uv tool install .` in the lele-harness repo or set LELE_BIN.";
const PROBE_TIMEOUT_MS = 10_000;
const KILL_WAIT_MS = 5_000;
const DEFAULT_PROMPT = "Start.";
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;

/**
 * Runs a lele sub-agent with the lele CLI: `lele -p <prompt> -a <name>` in the project directory.
 * The definition is written to `<projectDir>/.lele/agents/<name>/AGENTS.md` first, unless that file already has it.
 * lele reads the run's env from the process, so request.env is merged into the child's environment.
 */
export class LeleCliRunner implements AgentRunner {
  constructor(
    private readonly bin: string,
    private readonly projectDir: string,
  ) {}

  async status(): Promise<RuntimeStatus> {
    const version = await probeCommand(this.bin, ["--version"], PROBE_TIMEOUT_MS);
    if (version.error) {
      return { runner: RUNNER, available: false, detail: describeSpawnError(version.error, this.bin) };
    }
    const reported = stripAnsi(version.stdout).trim();
    if (!version.timedOut && version.code === 0 && reported) {
      return { runner: RUNNER, available: true, version: reported.split(/\r?\n/)[0], detail: `lele CLI at ${this.bin}` };
    }

    // Older builds may have no --version; a working --help still proves the binary runs.
    const help = await probeCommand(this.bin, ["--help"], PROBE_TIMEOUT_MS);
    if (!help.error && !help.timedOut && help.code === 0) {
      return { runner: RUNNER, available: true, detail: `lele CLI at ${this.bin} (no --version; --help answers)` };
    }
    const why = version.timedOut ? "did not answer within 10 s" : `exited with code ${version.code}`;
    return { runner: RUNNER, available: false, detail: `"${this.bin} --version" ${why}.` };
  }

  async *run(request: RunRequest, signal: AbortSignal): AsyncGenerator<RunEvent> {
    const startedAt = Date.now();
    let child: ChildProcess | undefined;
    let exited: Promise<void> = Promise.resolve();
    let onAbort: (() => void) | undefined;

    try {
      if (!isAgentId(request.name)) throw new Error(`"${request.name}" is not a valid lele agent name.`);
      await syncProjectDefinition(this.projectDir, request.name, request.definition);

      const args = ["-p", request.prompt || DEFAULT_PROMPT, "-a", request.name];
      const command = [this.bin, ...args].map(quoteArg).join(" ");
      yield { type: "run.started", runId: randomUUID(), runner: RUNNER, command, at: new Date().toISOString() };

      const proc = spawn(this.bin, args, {
        cwd: this.projectDir,
        shell: false,
        windowsHide: true,
        env: { ...process.env, ...request.env },
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
    }
  }
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

/** Stops the process; on Windows also its tree, since `lele` starts child processes for tools. */
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
