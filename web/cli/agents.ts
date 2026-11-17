#!/usr/bin/env bun
/**
 * Agent CLI. Run it through the package script, which sets the react-server condition the adapters need
 * (their `server-only` import is empty under that condition):
 *
 *   bun run agents list                                 list stored agents (AGENT_STORE=fs or mongo)
 *   bun run agents run <agentId> [--param k=v ...] [--prompt "text"] [--yaml]
 *   bun run agents chat <agentId> [--param k=v ...]     each line is one run; "exit" quits
 *   bun run agents verify                               check the MongoDB agent store (AGENT_STORE=mongo)
 *   bun run agents init                                 create or update the MongoDB collection, validator and indexes
 *   bun run agents help                                 show usage
 *
 * Options: --uri <mongodb-uri>, --db <database> override MONGODB_URI / MONGODB_DB.
 */
import { createInterface } from "node:readline";
import { compose, type CliComposition, type CliOverrides } from "./compose";
import type { AgentSummary, StoreCheck } from "../src/core/agents/agent-repository.port";
import { capabilities, type AgentSpec } from "../src/core/agents/agent-spec";
import type { AgentRunner, RunRequest } from "../src/core/runtime/agent-runner.port";

const COMMANDS = ["list", "run", "chat", "verify", "init", "help"] as const;

const USAGE = `Usage: bun run agents <command> [options]

Commands:
  list                    List stored agents
  run <agentId>           Run an agent once on the Goose runtime
  chat <agentId>          Chat with an agent: each line is one run, "exit" quits
  verify                  Check the MongoDB agent store (AGENT_STORE=mongo); exits 1 on failure
  init                    Create or update the MongoDB collection, validator and indexes, then check
  help                    Show this message

Run and chat options:
  --param key=value       Template variable for the agent (repeatable)
  --prompt "text"         Starting prompt for run (chat uses each line instead)
  --yaml                  Print the Goose recipe and exit

Environment:
  AGENT_STORE             fs (default; AGENTS_DIR, else ../agents) or mongo (MONGODB_URI, MONGODB_DB)
  GOOSE_BIN               goose executable (default "goose")
  Provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) and MCP env_keys are checked before a run.

Flags --uri and --db override the MongoDB environment.`;

const PROVIDER_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};


interface Options {
  command: string;
  agentId?: string;
  overrides: CliOverrides;
  params: Record<string, string>;
  prompt?: string;
  yaml: boolean;
}

const VALUE_FLAGS = new Set(["--uri", "--db", "--param", "--prompt"]);

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const params: Record<string, string> = {};
  let yaml = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--yaml") {
      yaml = true;
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (!flag.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error(`Unknown option ${flag}.`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith("--"))) throw new Error(`${flag} needs a value.`);
    if (flag === "--param") {
      const split = value.indexOf("=");
      const key = split === -1 ? "" : value.slice(0, split).trim();
      if (!key) throw new Error(`--param expects key=value, got "${value}".`);
      params[key] = value.slice(split + 1);
    } else {
      flags.set(flag, value);
    }
  }

  const command = help ? "help" : (positional[0] ?? "help");
  return {
    command,
    agentId: positional[1],
    overrides: { uri: flags.get("--uri"), db: flags.get("--db") },
    params,
    prompt: flags.get("--prompt"),
    yaml,
  };
}

// ---- output helpers ----------------------------------------------------------------------------

function paint(code: number, stream: NodeJS.WriteStream): (text: string) => string {
  const enabled = Boolean(stream.isTTY) && !process.env.NO_COLOR;
  return (text) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}
const yellowErr = paint(33, process.stderr);
const dimErr = paint(2, process.stderr);
const redErr = paint(31, process.stderr);

const warn = (message: string) => console.error(yellowErr(`! ${message}`));
const status = (message: string) => console.error(dimErr(message));
const fail = (message: string) => console.error(redErr(`Error: ${message}`));

function printChecks(checks: StoreCheck[]): void {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const mark = check.ok ? "✔" : "✖";
    console.log(`${mark} ${check.name.padEnd(width)}  ${check.detail}`);
  }
}

function printAgents(rows: AgentSummary[]): void {
  if (rows.length === 0) {
    console.log("No agents stored.");
    return;
  }
  const table = rows.map((row) => ({
    id: row.id,
    name: row.name,
    model: row.model ?? "-",
    updatedAt: row.updatedAt.toISOString(),
    problem: row.problem,
  }));
  const widths = {
    id: Math.max(...table.map((row) => row.id.length)),
    name: Math.max(...table.map((row) => row.name.length)),
    model: Math.max(...table.map((row) => row.model.length)),
  };
  for (const row of table) {
    const cells = [row.id.padEnd(widths.id), row.name.padEnd(widths.name), row.model.padEnd(widths.model), row.updatedAt];
    console.log(cells.join("  ") + (row.problem ? `  ✖ ${row.problem}` : ""));
  }
}

// ---- run preparation ---------------------------------------------------------------------------

/** Provider keys and MCP env_keys the spec needs, so missing secrets are reported before a run. */
function requiredKeys(spec: AgentSpec): string[] {
  const keys = new Set<string>();
  const models: string[] = spec.model ? [spec.model] : [];
  for (const capability of capabilities(spec)) {
    if (capability.kind !== "GooseExtension") for (const key of capability.args.env_keys ?? []) keys.add(key);
  }
  for (const model of models) {
    const provider = model.split(":")[0];
    const key = provider.startsWith("google") ? PROVIDER_KEYS.google : PROVIDER_KEYS[provider];
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Loads the agent, builds its Goose recipe, prints warnings and reports missing secrets. Never blocks. */
async function prepare(cli: CliComposition, agentId: string): Promise<{ yaml: string }> {
  const record = await cli.service.get(agentId);
  const { toGooseRecipe } = await import("../src/adapters/goose/goose-recipe");
  const recipe = toGooseRecipe(record.spec);
  for (const message of recipe.warnings) warn(message);

  const { missing } = await cli.credentials.resolve(requiredKeys(record.spec));
  if (missing.length > 0) {
    warn(`Not set in ${cli.credentials.describe()}: ${missing.join(", ")}. The run may fail.`);
  }
  return { yaml: recipe.yaml };
}

/** Returns an error message when the runner cannot run, otherwise null. */
async function checkRunner(runner: AgentRunner): Promise<string | null> {
  const runtime = await runner.status();
  if (!runtime.available) return `${runtime.runner} is not available: ${runtime.detail}`;
  status(`${runtime.runner}${runtime.version ? ` ${runtime.version}` : ""} ready`);
  return null;
}

/** Streams one run to the terminal. Returns the exit code for that run. */
async function streamRun(runner: AgentRunner, request: RunRequest, signal: AbortSignal): Promise<number> {
  let finished: { exitCode: number | null } | undefined;
  let failure: string | undefined;

  for await (const event of runner.run(request, signal)) {
    switch (event.type) {
      case "run.started":
        status(`▸ ${event.runner} run ${event.runId}`);
        break;
      case "run.output":
        (event.stream === "stderr" ? process.stderr : process.stdout).write(event.text);
        break;
      case "run.finished":
        finished = { exitCode: event.exitCode };
        status(`■ finished, exit ${event.exitCode ?? "-"}, ${(event.durationMs / 1000).toFixed(1)}s`);
        break;
      case "run.failed":
        failure = event.message;
        break;
    }
  }

  if (signal.aborted) {
    status("■ aborted");
    return 130;
  }
  if (failure !== undefined) {
    fail(failure);
    return 1;
  }
  if (!finished) return 1;
  return finished.exitCode ?? 1;
}

// ---- commands ----------------------------------------------------------------------------------

async function list(cli: CliComposition): Promise<number> {
  const summaries = await cli.service.list();
  console.log(`${summaries.length} agent(s) in ${cli.label} (AGENT_STORE=${cli.store})`);
  printAgents(summaries);
  return 0;
}

async function storeChecks(cli: CliComposition, command: "verify" | "init"): Promise<number> {
  if (!cli.mongo) {
    fail(`verify/init apply to AGENT_STORE=mongo (current store: ${cli.store}).`);
    return 1;
  }
  const checks = command === "init" ? await cli.mongo.provision() : await cli.mongo.verify();
  printChecks(checks);
  const failed = checks.filter((check) => !check.ok).length;
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

async function runOnce(cli: CliComposition, options: Options): Promise<number> {
  const agentId = requireAgentId(options);
  const { yaml } = await prepare(cli, agentId);
  if (options.yaml) {
    process.stdout.write(yaml.endsWith("\n") ? yaml : `${yaml}\n`);
    return 0;
  }
  const runner = await cli.runner();
  const unavailable = await checkRunner(runner);
  if (unavailable) {
    fail(unavailable);
    return 2;
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.on("SIGINT", onInterrupt);
  try {
    return await streamRun(runner, { definition: yaml, params: options.params, prompt: options.prompt }, controller.signal);
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

async function chat(cli: CliComposition, options: Options): Promise<number> {
  const agentId = requireAgentId(options);
  const { yaml } = await prepare(cli, agentId);
  const runner = await cli.runner();
  const unavailable = await checkRunner(runner);
  if (unavailable) {
    fail(unavailable);
    return 2;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
    prompt: `${agentId}> `,
  });
  // Ctrl+C stops the running reply; with no reply running it leaves the chat.
  let active: AbortController | undefined;
  rl.on("SIGINT", () => {
    if (active) active.abort();
    else rl.close();
  });

  status(`Chatting with ${agentId}. Each line is one run; "exit" quits, Ctrl+C stops a reply.`);
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === "exit") break;
    if (text) {
      active = new AbortController();
      try {
        await streamRun(runner, { definition: yaml, params: options.params, prompt: text }, active.signal);
      } finally {
        active = undefined;
      }
    }
    rl.prompt();
  }
  rl.close();
  return 0;
}

function requireAgentId(options: Options): string {
  if (!options.agentId) throw new Error(`"${options.command}" needs an agent id, e.g. bun run agents ${options.command} my-agent.`);
  return options.agentId;
}

// ---- entry -------------------------------------------------------------------------------------

async function main(options: Options): Promise<number> {
  if (options.command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (!(COMMANDS as readonly string[]).includes(options.command)) {
    console.error(`Unknown command "${options.command}".\n`);
    console.error(USAGE);
    return 1;
  }

  const cli = await compose(options.overrides);
  try {
    switch (options.command) {
      case "list":
        return await list(cli);
      case "verify":
      case "init":
        return await storeChecks(cli, options.command);
      case "run":
        return await runOnce(cli, options);
      case "chat":
        return await chat(cli, options);
      default:
        return 1;
    }
  } finally {
    await cli.close();
  }
}

try {
  process.exitCode = await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
