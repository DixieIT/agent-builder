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
 *   bun run agents dump <dir>                           write all agents and library items as a folder bundle
 *   bun run agents import <path> [--dry-run] [--project <id>]  import a tool/skill/capability/agent item, or a whole bundle
 *   bun run agents library [tools|skills|capabilities]  list library items (SQLite)
 *   bun run agents systems                              list the agent systems in AGENT_SYSTEMS
 *   bun run agents inspect <system> [agent]             list a system's agents, or describe one (capabilities, tools, sub-agents)
 *   bun run agents config list|get|set|unset            saved settings (non-secret; secrets go under Environment)
 *   bun run agents projects list|create|use|show        projects: their agents and systems
 *   bun run agents help                                 show usage
 *
 * Options: --uri <mongodb-uri>, --db <database> override MONGODB_URI / MONGODB_DB.
 */
import { createInterface } from "node:readline";
import path from "node:path";
import { compose, type CliComposition, type CliOverrides } from "./compose";
import type { AgentSummary, StoreCheck } from "../src/core/agents/agent-repository.port";
import { ENVIRONMENTS, type Environment } from "../src/core/environment/environment";
import type { BundleContent } from "../src/core/library/bundle.port";
import type { LibraryItem, LibraryKind } from "../src/core/library/library";
import type { LibraryRepository } from "../src/core/library/library-repository.port";
import type { AgentRunner, RunEvent } from "../src/core/runtime/agent-runner.port";
import type { AgentDescriptor } from "../src/core/systems/agent-system";
import type { SettingsStore } from "../src/core/projects/project-repository.port";

const COMMANDS = ["list", "run", "chat", "verify", "init", "dump", "import", "library", "systems", "inspect", "config", "projects", "help"] as const;

const USAGE = `Usage: bun run agents <command> [options]

Commands:
  list                    List stored agents
  run <agentId>           Run an agent once on its runtime (Goose or lele)
  chat <agentId>          Chat with an agent: each line is one run, "exit" quits
  verify                  Check the MongoDB agent store (AGENT_STORE=mongo); exits 1 on failure
  init                    Create or update the MongoDB collection, validator and indexes, then check
  dump <dir>              Write all agents and library items to <dir> as a folder bundle
  import <path>           Import one item (tools/<name>, skills/<name>, capabilities/<name>.yaml, agents/<id>),
                          any folder of items (agents/, .lele/agents, Goose recipes) or a whole bundle
  library [kind]          List library items (kind: tools, skills or capabilities; default all)
  systems                 List the agent systems configured in AGENT_SYSTEMS
  inspect <system> [agent]
                          List a system's agents with capability and sub-agent counts, or describe one:
                          its model, facts, capabilities with each tool's access, and sub-agents
  config list             List saved settings (values of secret-looking keys are masked)
  config get <KEY>        Print one saved setting
  config set <KEY> <value>
                          Save a setting. Keys are UPPER_SNAKE_CASE. Secrets are refused: add
                          them under Environment (ENV_SOURCE) instead
  config unset <KEY>      Remove a saved setting
  projects list           List projects; the current one is marked
  projects create <name> [--description text]
                          Create a project with its own agent store
  projects use <id>       Make a project the current one (config set UAB_PROJECT <id>)
  projects show [id]      A project's systems and agent count (default: the current project)
  help                    Show this message

Saved settings (config set; env vars set in the shell win over them):
  AGENT_SYSTEMS           Agent systems to explore, comma-separated (default "builder")
  AGENT_STORE             Agent store: fs (default), sqlite, mongo or lele
  UAB_PROJECT             The current project's id (set with projects use)
  LELE_PROJECT_DIR        lele project folder (AGENT_STORE=lele)
  LELE_HARNESS_DIR        lele-harness checkout (the built-in lele agents)
  ENV_SOURCE              Where environment variables live: folder (default) or sqlite
  ENV_DIR                 Folder of .env files when ENV_SOURCE=folder (default env/)
  (litellm:<url> in AGENT_SYSTEMS or a project's systems reads a LiteLLM gateway; key: LITELLM_API_KEY in Environment)

Agent systems (AGENT_SYSTEMS, comma-separated, default "builder"):
  builder                 the builder's own store (AGENT_STORE)
  lele:<projectDir>       a lele project's agents (its .lele/agents plus the global and bundled layers)
  fs:<dir>                a folder of builder agent specs (read-only)
  sqlite:<file>           a builder SQLite store (read-only)

Run and chat options:
  --param key=value       Template variable for the agent (repeatable)
  --prompt "text"         Starting prompt for run (chat uses each line instead)
  --env <name>            Environment whose variables the run gets: development (default), preview, production
  --yaml                  Print the harness definition (Goose recipe or lele AGENTS.md) and exit

Import options:
  --dry-run               Read and validate the bundle, save nothing
  --project <id>          Import into that project's agent store (default: the builder's store)

Project options:
  --description <text>    Description for projects create

Environment:
  AGENT_STORE             fs (default; AGENTS_DIR, else ../agents), mongo (MONGODB_URI, MONGODB_DB)
                          or sqlite (UAB_DB, UAB_SECRET_KEY)
  UAB_DB                  SQLite file for the library (and for agents with AGENT_STORE=sqlite)
                          (default data/uab.sqlite in the repo root)
  UAB_SECRET_KEY          Secret for encrypted values in the SQLite store
  GOOSE_BIN               goose executable (default "goose")
  Provider keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY) and MCP env_keys are checked before a run.

Flags --uri and --db override the MongoDB environment.`;

interface Options {
  command: string;
  /** The first argument after the command: an agent id, a bundle path or a library kind. */
  arg?: string;
  agentId?: string;
  /** Every positional argument after the command (inspect takes a system and an agent). */
  args: string[];
  overrides: CliOverrides;
  params: Record<string, string>;
  prompt?: string;
  yaml: boolean;
  dryRun: boolean;
  environment: Environment;
  /** import --project: the project whose store receives the items. */
  project?: string;
  /** projects create --description. */
  description?: string;
}

const VALUE_FLAGS = new Set(["--uri", "--db", "--param", "--prompt", "--env", "--project", "--description"]);

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const params: Record<string, string> = {};
  let yaml = false;
  let dryRun = false;
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
    if (arg === "--dry-run") {
      dryRun = true;
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
  const environment = (flags.get("--env") ?? "development") as Environment;
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`--env must be one of ${ENVIRONMENTS.join(", ")}.`);
  return {
    command,
    arg: positional[1],
    agentId: positional[1],
    args: positional.slice(1),
    overrides: { uri: flags.get("--uri"), db: flags.get("--db") },
    params,
    prompt: flags.get("--prompt"),
    yaml,
    dryRun,
    environment,
    project: flags.get("--project"),
    description: flags.get("--description"),
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

/** Returns an error message when the runner cannot run, otherwise null. */
async function checkRunner(runner: AgentRunner): Promise<string | null> {
  const runtime = await runner.status();
  if (!runtime.available) return `${runtime.runner} is not available: ${runtime.detail}`;
  status(`${runtime.runner}${runtime.version ? ` ${runtime.version}` : ""} ready`);
  return null;
}

/** Streams one run to the terminal. Returns the exit code for that run. */
async function streamRun(events: AsyncIterable<RunEvent>, signal: AbortSignal): Promise<number> {
  let finished: { exitCode: number | null } | undefined;
  let failure: string | undefined;
  let atLineStart = true;
  const EOL = "\n";

  for await (const event of events) {
    if (event.type !== "run.output" && !atLineStart) {
      process.stdout.write(EOL);
      atLineStart = true;
    }
    switch (event.type) {
      case "run.tool":
        status(`  -> ${event.name}${event.output === undefined ? "" : " done"}`);
        break;
      case "run.started":
        status(`▸ ${event.runner} run ${event.runId}`);
        break;
      case "run.output":
        (event.stream === "stderr" ? process.stderr : process.stdout).write(event.text);
        if (event.text) atLineStart = event.text.endsWith(EOL);
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
  const summaries = await (await cli.service()).list();
  console.log(`${summaries.length} agent(s) in ${cli.label} (AGENT_STORE=${cli.store})`);
  printAgents(summaries);
  return 0;
}

async function storeChecks(cli: CliComposition, command: "verify" | "init"): Promise<number> {
  const provisionable = await cli.provisionable();
  if (!provisionable) {
    fail(`verify/init apply to the mongo and sqlite stores (current store: ${cli.store}).`);
    return 1;
  }
  const checks = command === "init" ? await provisionable.provision() : await provisionable.verify();
  printChecks(checks);
  const failed = checks.filter((check) => !check.ok).length;
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
  return failed === 0 ? 0 : 1;
}

async function runOnce(cli: CliComposition, options: Options): Promise<number> {
  const agentId = requireAgentId(options);
  const runs = await cli.runs();
  const exported = await runs.export(agentId);
  if (options.yaml) {
    process.stdout.write(exported.definition.endsWith("\n") ? exported.definition : `${exported.definition}\n`);
    return 0;
  }
  const runner = await cli.runner(exported.spec.runtime);
  const unavailable = await checkRunner(runner);
  if (unavailable) {
    fail(unavailable);
    return 2;
  }

  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  process.on("SIGINT", onInterrupt);
  try {
    const events = runs.run(agentId, { params: options.params, prompt: options.prompt, environment: options.environment }, controller.signal);
    return await streamRun(events, controller.signal);
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

async function chat(cli: CliComposition, options: Options): Promise<number> {
  const agentId = requireAgentId(options);
  const runs = await cli.runs();
  const exported = await runs.export(agentId);
  const runner = await cli.runner(exported.spec.runtime);
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
        const signal = active.signal;
        await streamRun(runs.run(agentId, { params: options.params, prompt: text, environment: options.environment }, signal), signal);
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

// ---- bundles and library -----------------------------------------------------------------------

const LIBRARY_KINDS: Record<string, LibraryKind> = {
  tools: "tool",
  skills: "skill",
  capabilities: "capability",
};

interface LibraryRow {
  name: string;
  detail: string;
  description: string;
  updatedAt: Date;
}

async function allLibraryItems(library: LibraryRepository): Promise<LibraryItem[]> {
  const [tools, skills, capabilities] = await Promise.all([library.tools.list(), library.skills.list(), library.capabilities.list()]);
  return [
    ...tools.map(({ item }) => ({ kind: "tool" as const, item })),
    ...skills.map(({ item }) => ({ kind: "skill" as const, item })),
    ...capabilities.map(({ item }) => ({ kind: "capability" as const, item })),
  ];
}

async function dump(cli: CliComposition, options: Options): Promise<number> {
  if (!options.arg) throw new Error(`"dump" needs a directory, e.g. bun run agents dump ./bundle.`);
  const agents: BundleContent["agents"] = [];
  const service = await cli.service();
  for (const summary of await service.list()) {
    if (summary.problem) {
      warn(`Skipped agent ${summary.id}: ${summary.problem}`);
      continue;
    }
    const record = await service.get(summary.id);
    agents.push({ id: record.id, spec: record.spec });
  }
  const items = await allLibraryItems(await cli.library());
  const written = await cli.bundle.dump(options.arg, { agents, items });
  console.log(`Wrote ${agents.length} agent(s) and ${items.length} library item(s) to ${path.resolve(options.arg)} (${written.length} files).`);
  return 0;
}

/** One line per item. Items are validated by the codec when the bundle is read; saving reports store errors. */
async function importBundle(cli: CliComposition, options: Options): Promise<number> {
  if (!options.arg) throw new Error(`"import" needs a path, e.g. bun run agents import tools/search_docs.`);
  const content = await cli.bundle.read(options.arg);
  const importer = options.project ? await cli.projectImporter(options.project) : await cli.importer();
  const report = await importer.import(content, { dryRun: options.dryRun });
  for (const line of report.lines) {
    const label = `${line.kind} ${line.name}`;
    console.log(line.ok ? `✔ ${label}${line.replaced ? " (replaced)" : ""}` : `✖ ${label}: ${line.message}`);
    for (const warning of line.warnings ?? []) console.log(`  ! ${warning}`);
  }
  if (report.dryRun) console.log("Dry run: nothing was saved.");
  return report.failed === 0 ? 0 : 1;
}

async function libraryRowsOf(library: LibraryRepository, kind: LibraryKind): Promise<LibraryRow[]> {
  switch (kind) {
    case "tool":
      return library.tools
        .list()
        .then((rows) => rows.map(({ item, updatedAt }) => ({ name: item.name, detail: item.language, description: item.description, updatedAt })));
    case "skill":
      return library.skills
        .list()
        .then((rows) =>
          rows.map(({ item, updatedAt }) => ({ name: item.name, detail: `${Object.keys(item.files).length} file(s)`, description: item.description, updatedAt })),
        );
    case "capability":
      return library.capabilities
        .list()
        .then((rows) => rows.map(({ item, updatedAt }) => ({ name: item.name, detail: Object.keys(item.entry)[0], description: item.description, updatedAt })));
  }
}

async function listLibrary(cli: CliComposition, options: Options): Promise<number> {
  const wanted = options.arg;
  if (wanted !== undefined && !(wanted in LIBRARY_KINDS)) {
    throw new Error(`Unknown library kind "${wanted}"; use tools, skills or capabilities.`);
  }
  const library = await cli.library();
  const kinds: [string, LibraryKind][] = Object.entries(LIBRARY_KINDS).filter(([name]) => wanted === undefined || name === wanted);
  for (const [name, kind] of kinds) {
    const rows = await libraryRowsOf(library, kind);
    console.log(`${name} (${rows.length}) in SQLite`);
    if (rows.length === 0) console.log("  none");
    const width = {
      name: Math.max(...rows.map((row) => row.name.length)),
      detail: Math.max(...rows.map((row) => row.detail.length)),
    };
    for (const row of rows) {
      console.log(`  ${row.name.padEnd(width.name)}  ${row.detail.padEnd(width.detail)}  ${row.updatedAt.toISOString()}  ${row.description}`);
    }
  }
  return 0;
}

// ---- agent systems -----------------------------------------------------------------------------

/** Pads each column to its widest cell. The first row is the header. */
function printRows(rows: string[][]): void {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  for (const row of rows) {
    const line = row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join("  ");
    console.log(line.trimEnd());
  }
}

async function listSystems(cli: CliComposition): Promise<number> {
  const infos = (await cli.systems()).map((system) => system.info());
  console.log(`${infos.length} system(s) (AGENT_SYSTEMS)`);
  printRows([
    ["id", "label", "kind", "editable", "location"],
    ...infos.map((info) => [info.id, info.label, info.kind, info.editable ? "yes" : "no", info.location]),
  ]);
  return 0;
}

async function inspectSystem(cli: CliComposition, options: Options): Promise<number> {
  if (!options.arg) throw new Error(`"inspect" needs a system id, e.g. bun run agents inspect lele. List them with bun run agents systems.`);
  const system = await cli.system(options.arg);
  const agentId = options.args[1];
  if (agentId) {
    printAgent(await system.describe(agentId));
    return 0;
  }
  const info = system.info();
  const listings = await system.list();
  console.log(`${info.label} (${info.kind}): ${listings.length} agent(s) at ${info.location}`);
  printRows([
    ["id", "name", "model", "capabilities", "sub-agents", "problem"],
    ...listings.map((row) => [row.id, row.name, row.model ?? "-", String(row.capabilityCount), String(row.subAgentCount), row.problem ?? ""]),
  ]);
  return 0;
}

function printAgent(agent: AgentDescriptor): void {
  console.log(`${agent.name} (${agent.id})`);
  if (agent.description) console.log(`  ${agent.description}`);
  console.log(`  model: ${agent.model ?? "-"}`);
  for (const fact of agent.facts) console.log(`  ${fact.label}: ${fact.value}`);
  if (agent.editPath) console.log(`  editable in the builder: ${agent.editPath}`);

  console.log(`\nCapabilities (${agent.capabilities.length}):`);
  if (agent.capabilities.length === 0) console.log("  none");
  for (const view of agent.capabilities) {
    const description = view.capability.description ? ` - ${view.capability.description}` : "";
    console.log(`  ${view.capability.id}${description}`);
    if (view.tools.length > 0) {
      const width = Math.max(...view.tools.map(({ tool }) => tool.name.length));
      for (const { tool, access } of view.tools) console.log(`    ${tool.name.padEnd(width)}  ${access}`);
    }
    if (view.note) console.log(`    note: ${view.note}`);
  }

  console.log(`\nSub-agents (${agent.subAgents.length}):`);
  if (agent.subAgents.length === 0) console.log("  none");
  for (const link of agent.subAgents) console.log(`  ${link.id}  (${link.via})`);
}

// ---- settings and projects ---------------------------------------------------------------------

/** Keys that look like credentials. They never go in the saved settings: they belong under Environment. */
const SECRET_KEY = /KEY|SECRET|TOKEN|PASSWORD/;
const SETTING_NAME = /^[A-Z][A-Z0-9_]*$/;
const CURRENT_PROJECT = "UAB_PROJECT";

function settingName(key: string | undefined): string {
  if (!key) throw new Error(`Give a setting name in UPPER_SNAKE_CASE, e.g. bun run agents config get AGENT_STORE.`);
  if (!SETTING_NAME.test(key)) throw new Error(`Setting names are UPPER_SNAKE_CASE (A-Z, 0-9 and _), got "${key}".`);
  return key;
}

const shown = (key: string, value: string) => (SECRET_KEY.test(key) ? "********" : value);

/** The current project: the UAB_PROJECT environment variable, else the saved setting. */
function currentProjectId(settings: SettingsStore): string | undefined {
  return process.env[CURRENT_PROJECT] || settings.get(CURRENT_PROJECT) || undefined;
}

async function config(cli: CliComposition, options: Options): Promise<number> {
  const [sub, key, ...rest] = options.args;
  switch (sub) {
    case "list": {
      const all = (await cli.settings()).all();
      const keys = Object.keys(all).sort();
      if (keys.length === 0) {
        console.log("No settings saved. Save one with bun run agents config set <KEY> <value>.");
        return 0;
      }
      const width = Math.max(...keys.map((name) => name.length));
      for (const name of keys) console.log(`${name.padEnd(width)}  ${shown(name, all[name])}`);
      return 0;
    }
    case "get": {
      const name = settingName(key);
      const value = (await cli.settings()).get(name);
      if (value === undefined) {
        console.error(`${name} is not set.`);
        return 1;
      }
      console.log(shown(name, value));
      return 0;
    }
    case "set": {
      const name = settingName(key);
      if (SECRET_KEY.test(name)) {
        console.error(`Secrets don't go in the config: add ${name} under Environment (ENV_SOURCE) instead.`);
        return 1;
      }
      if (rest.length === 0) throw new Error(`"config set" needs a value, e.g. bun run agents config set ${name} value.`);
      (await cli.settings()).set(name, rest.join(" "));
      console.log(`Saved ${name}.`);
      return 0;
    }
    case "unset": {
      const name = settingName(key);
      const settings = await cli.settings();
      if (settings.get(name) === undefined) {
        console.log(`${name} was not set.`);
        return 0;
      }
      settings.unset(name);
      console.log(`Removed ${name}.`);
      return 0;
    }
    default:
      console.error("Usage: bun run agents config list | get <KEY> | set <KEY> <value> | unset <KEY>");
      return 1;
  }
}

async function projects(cli: CliComposition, options: Options): Promise<number> {
  const [sub, ...rest] = options.args;
  const repository = await cli.projects();
  switch (sub) {
    case "list": {
      const all = await repository.list();
      if (all.length === 0) {
        console.log("No projects yet. Create one with bun run agents projects create <name>.");
        return 0;
      }
      const current = currentProjectId(await cli.settings());
      console.log(`${all.length} project(s)`);
      printRows([
        ["id", "name", "systems", "current", "description"],
        ...all.map((project) => [project.id, project.name, String(project.systems.length), project.id === current ? "*" : "", project.description]),
      ]);
      return 0;
    }
    case "create": {
      const name = rest.join(" ").trim();
      if (!name) throw new Error(`"projects create" needs a name, e.g. bun run agents projects create "My team".`);
      const project = await repository.create({ name, description: options.description ?? "", systems: [] });
      console.log(`Created project ${project.id} (${project.name}).`);
      console.log(`Use it with: bun run agents projects use ${project.id}`);
      return 0;
    }
    case "use": {
      const id = rest[0];
      if (!id) throw new Error(`"projects use" needs a project id, e.g. bun run agents projects use my-team.`);
      const project = await repository.get(id);
      (await cli.settings()).set(CURRENT_PROJECT, project.id);
      console.log(`Current project: ${project.id} (${project.name}).`);
      const fromEnvironment = process.env[CURRENT_PROJECT];
      if (fromEnvironment && fromEnvironment !== project.id) warn(`${CURRENT_PROJECT} is also set in the environment (${fromEnvironment}); the environment value wins.`);
      return 0;
    }
    case "show": {
      const id = rest[0] ?? currentProjectId(await cli.settings());
      if (!id) throw new Error(`No project given. Pass an id, or pick one with bun run agents projects use <id>.`);
      const project = await repository.get(id);
      const [agents, systems] = await Promise.all([repository.agents(project.id).list(), cli.projectSystems(project.id)]);
      console.log(`${project.name} (${project.id})`);
      if (project.description) console.log(`  ${project.description}`);
      console.log(`  agents: ${agents.length}`);
      console.log(`\nSystems (${systems.length}):`);
      if (systems.length === 0) {
        console.log("  none");
        return 0;
      }
      printRows([
        ["id", "label", "kind", "editable", "location"],
        ...systems.map((system) => {
          const info = system.info();
          return [info.id, info.label, info.kind, info.editable ? "yes" : "no", info.location];
        }),
      ]);
      return 0;
    }
    default:
      console.error("Usage: bun run agents projects list | create <name> [--description text] | use <id> | show [id]");
      return 1;
  }
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
      case "dump":
        return await dump(cli, options);
      case "import":
        return await importBundle(cli, options);
      case "library":
        return await listLibrary(cli, options);
      case "systems":
        return await listSystems(cli);
      case "inspect":
        return await inspectSystem(cli, options);
      case "config":
        return await config(cli, options);
      case "projects":
        return await projects(cli, options);
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
