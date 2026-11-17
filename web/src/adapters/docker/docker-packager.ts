import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

import type {
  AgentPackager,
  BuildContext,
  BuildEvent,
  PackageRequest,
} from "../../core/runtime/agent-packager.port";

const TAG_PATTERN = /^[a-z0-9][a-z0-9._\/-]*(:[A-Za-z0-9._-]{1,128})?$/;

const MISSING_CLI_MESSAGE = "Docker CLI not found. Install Docker Desktop or set DOCKER_BIN.";

/** Entrypoint forwards any arguments to `goose run`, e.g. `docker run IMAGE --params user_name=Ada`. */
const ENTRYPOINT_SH = [
  "#!/bin/sh",
  "set -e",
  "# Provider credentials are read from the environment at `docker run` time, e.g.:",
  "#   -e GOOSE_PROVIDER=... -e GOOSE_MODEL=... -e ANTHROPIC_API_KEY=...",
  "# (or the API key variable required by the chosen provider).",
  "# Extra arguments are passed through to `goose run`.",
  'exec goose run --recipe /agent/recipe.yaml --no-session "$@"',
  "",
].join("\n");

const DOCKERIGNORE = "*\n!recipe.yaml\n!entrypoint.sh\n!Dockerfile\n";

/** Dockerfile LABEL values use JSON-style quoting, so JSON.stringify yields a safe literal. */
function quoteLabel(value: string): string {
  return JSON.stringify(value);
}

function dockerfileFor(agentId: string): string {
  const label = quoteLabel(agentId);
  return [
    "# syntax=docker/dockerfile:1",
    "FROM debian:bookworm-slim",
    "ARG GOOSE_VERSION=stable",
    "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bzip2 libxcb1 libdbus-1-3 nodejs npm python3 python3-venv \\",
    "    && rm -rf /var/lib/apt/lists/* \\",
    "    && curl -fsSL https://github.com/block/goose/releases/download/${GOOSE_VERSION}/download_cli.sh | CONFIGURE=false GOOSE_BIN_DIR=/usr/local/bin bash",
    "RUN useradd --create-home --uid 10001 agent",
    "WORKDIR /home/agent",
    "COPY --chown=agent:agent recipe.yaml /agent/recipe.yaml",
    "COPY --chown=agent:agent entrypoint.sh /agent/entrypoint.sh",
    "USER agent",
    "ENV GOOSE_MODE=auto NO_COLOR=1",
    `LABEL org.opencontainers.image.title=${label} io.ultimate-agent-builder.agent=${label}`,
    'ENTRYPOINT ["/bin/sh", "/agent/entrypoint.sh"]',
    "",
  ].join("\n");
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Splits a stream into lines and forwards each non-empty line to `onLine`. */
function forwardLines(stream: Readable, onLine: (line: string) => void): void {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) onLine(line);
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) onLine(pending);
    pending = "";
  });
}

export class DockerPackager implements AgentPackager {
  constructor(private readonly bin: string) {}

  context(request: PackageRequest): BuildContext {
    return {
      files: {
        "recipe.yaml": request.definition,
        Dockerfile: dockerfileFor(request.agentId),
        "entrypoint.sh": ENTRYPOINT_SH,
        ".dockerignore": DOCKERIGNORE,
      },
    };
  }

  async *build(request: PackageRequest, signal: AbortSignal): AsyncIterable<BuildEvent> {
    if (!TAG_PATTERN.test(request.tag)) {
      yield { type: "build.failed", message: `Invalid image tag: ${request.tag}` };
      return;
    }
    if (signal.aborted) {
      yield { type: "build.failed", message: "Build cancelled before it started." };
      return;
    }

    let contextDir: string | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    const onAbort = (): void => {
      killProcess(child);
    };

    try {
      contextDir = await mkdtemp(path.join(os.tmpdir(), "uab-build-"));
      const { files } = this.context(request);
      await Promise.all(
        Object.entries(files).map(([name, contents]) =>
          writeFile(path.join(contextDir as string, name), contents, "utf8"),
        ),
      );

      yield {
        type: "build.started",
        tag: request.tag,
        contextDir,
        at: new Date().toISOString(),
      };

      const queue: BuildEvent[] = [];
      let wake: (() => void) | undefined;
      let finished = false;
      let exitCode: number | null = null;
      let spawnError: unknown;

      const notify = (): void => {
        const resume = wake;
        wake = undefined;
        resume?.();
      };
      const push = (event: BuildEvent): void => {
        queue.push(event);
        notify();
      };

      const startedAt = Date.now();
      child = spawn(this.bin, ["build", "--progress=plain", "-t", request.tag, contextDir], {
        env: { ...process.env, DOCKER_BUILDKIT: "1" },
        windowsHide: true,
      });

      if (child.stdout) {
        forwardLines(child.stdout, (text) => push({ type: "build.output", text }));
      }
      if (child.stderr) {
        forwardLines(child.stderr, (text) => push({ type: "build.output", text }));
      }
      child.on("error", (err: unknown) => {
        spawnError = err;
        finished = true;
        notify();
      });
      child.on("close", (code: number | null) => {
        exitCode = code;
        finished = true;
        notify();
      });

      signal.addEventListener("abort", onAbort, { once: true });

      while (true) {
        for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
          yield event;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      if (spawnError !== undefined) {
        yield {
          type: "build.failed",
          message: isErrnoCode(spawnError, "ENOENT")
            ? MISSING_CLI_MESSAGE
            : `Failed to run docker build: ${errorMessage(spawnError)}`,
        };
        return;
      }

      yield {
        type: "build.finished",
        tag: request.tag,
        exitCode,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      yield { type: "build.failed", message: errorMessage(err) };
    } finally {
      signal.removeEventListener("abort", onAbort);
      killProcess(child);
      if (contextDir !== undefined) {
        await rm(contextDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

/** Kills the docker CLI and its children (on Windows, the whole process tree). Safe to call repeatedly. */
function killProcess(child: ReturnType<typeof spawn> | undefined): void {
  if (!child || child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill();
    });
  } else {
    child.kill("SIGTERM");
  }
}
