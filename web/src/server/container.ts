import "server-only";

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Authenticator } from "@/core/auth/authenticator.port";
import type { CredentialStore } from "@/core/auth/credential-store.port";
import type { AgentEventBus } from "@/core/agents/agent-events.port";
import type { AgentRepository } from "@/core/agents/agent-repository.port";
import { AgentService } from "@/core/agents/agent-service";
import type { Runtime } from "@/core/agents/agent-spec";
import type { EnvironmentStore } from "@/core/environment/environment-store.port";
import type { LibraryRepository } from "@/core/library/library-repository.port";
import type { AgentExporter } from "@/core/runtime/agent-exporter.port";
import type { AgentPackager } from "@/core/runtime/agent-packager.port";
import type { AgentRunner } from "@/core/runtime/agent-runner.port";
import type { CapabilityCatalog } from "@/core/capabilities/capability-catalog.port";
import { RunService } from "@/core/runtime/run-service";
import { ImportService } from "@/core/library/import-service";
import type { BundleCodec } from "@/core/library/bundle.port";
import { FsBundleCodec } from "@/adapters/bundle/fs-bundle-codec";
import type { ToolInspector } from "@/core/tools/tool-inspector.port";
import { ApiKeyAuthenticator, type ApiKeyGrant } from "@/adapters/auth/api-key-authenticator";
import { EnvCredentialStore } from "@/adapters/auth/env-credential-store";
import { MemoryEventBus } from "@/adapters/events/memory-event-bus";
import { GooseExporter } from "@/adapters/goose/goose-exporter";
import { McpToolInspector } from "@/adapters/mcp/mcp-tool-inspector";
import { RepositoryAgentSystem } from "@/adapters/systems/repository-agent-system";
import type { AgentSystemInfo } from "@/core/systems/agent-system";
import type { AgentSystem } from "@/core/systems/agent-system.port";
import type { Project, SystemSource } from "@/core/projects/project";
import type { ProjectRepository, SettingsStore } from "@/core/projects/project-repository.port";
import { AgentSystemNotFoundError } from "@/core/shared/errors";
import type { SqliteStores } from "@/adapters/sqlite";
import { openSqlite } from "@/adapters/sqlite/sqlite-db";
import { SqliteSettingsStore } from "@/adapters/sqlite/sqlite-settings-store";

/**
 * Composition root: the only place that knows which adapter backs each port.
 *   AGENT_STORE   fs (default, AGENTS_DIR) | sqlite (UAB_DB) | mongo (MONGODB_URI, MONGODB_DB) | lele (LELE_PROJECT_DIR)
 *   ENV_SOURCE    folder (default, ENV_DIR with .env.<environment> files) | sqlite (UAB_DB, encrypted with UAB_SECRET_KEY)
 *   UAB_DB        SQLite file for the library (always) and for sqlite stores; default <repo>/data/uab.sqlite
 *   GOOSE_BIN, DOCKER_BIN, LELE_BIN, LELE_SERVE_URL, LELE_HARNESS_DIR
 *   UV_BIN                    uv executable used to boot lele's kernel for the capability catalog (default "uv" on PATH)
 *   LELE_INTROSPECT_SCRIPT    path to the introspect.py that dumps lele's capabilities (default src/adapters/lele/introspect.py under web/)
 *   UAB_API_KEYS  "id:key:scope1|scope2,id2:key2:*" (empty = auth disabled, dev mode)
 *   AGENT_SYSTEMS comma-separated systems the explorer inspects (default "builder"):
 *                 builder            the builder's own store (AGENT_STORE); editable here
 *                 lele:<projectDir>  a lele project's agents (.lele/agents, global and bundled layers); editable only for LELE_PROJECT_DIR
 *                 fs:<dir>           a folder of builder agent specs (read-only)
 *                 sqlite:<file>      a builder SQLite store (read-only)
 *               Adding a kind (another platform's database, a Goose recipe folder...): write ONE adapter implementing
 *               core/systems/agent-system.port.ts (or a RepositoryAgentSystem over its AgentRepository), add a colocated test
 *               calling agentSystemContract(...), then one case in buildAgentSystems() below. Nothing else changes.
 */

export type StoreKind = "fs" | "mongo" | "sqlite" | "lele";
const REPO_ROOT = path.resolve(process.cwd(), "..");

export function storeKind(): StoreKind {
  const kind = process.env.AGENT_STORE;
  return kind === "mongo" || kind === "sqlite" || kind === "lele" ? kind : "fs";
}

export function envSourceKind(): "folder" | "sqlite" {
  return process.env.ENV_SOURCE === "sqlite" ? "sqlite" : "folder";
}

const paths = {
  db: () => process.env.UAB_DB ?? path.join(REPO_ROOT, "data", "uab.sqlite"),
  agents: () => process.env.AGENTS_DIR ?? path.join(REPO_ROOT, "agents"),
  env: () => process.env.ENV_DIR ?? path.join(REPO_ROOT, "env"),
  leleProject: () => process.env.LELE_PROJECT_DIR ?? REPO_ROOT,
  leleHarness: () => process.env.LELE_HARNESS_DIR ?? path.resolve(REPO_ROOT, "..", "lele-harness"),
};

applySavedSettings();

/**
 * Settings saved with `agents config set` (the settings table) become defaults for process.env; variables set in
 * the real environment still win. Synchronous, once per process. Never throws: a missing file or a database
 * without the table (before schema v2) just means no saved settings.
 */
function applySavedSettings(): void {
  try {
    const file = paths.db();
    if (!existsSync(file)) return;
    const db = openSqlite(file);
    try {
      for (const [key, value] of Object.entries(new SqliteSettingsStore(db).all())) process.env[key] ??= value;
    } finally {
      db.close();
    }
  } catch {
    // Nothing saved yet, or the file is not a readable builder database: run on the environment alone.
  }
}

type Cache = {
  sqlite?: Promise<Awaited<ReturnType<typeof openSqliteStores>>>;
  repository?: Promise<AgentRepository>;
  service?: Promise<AgentService>;
  runs?: Promise<RunService>;
  events?: AgentEventBus;
  inspector?: ToolInspector;
  runners: Partial<Record<Runtime, Promise<AgentRunner>>>;
  exporters: Partial<Record<Runtime, AgentExporter>>;
  packager?: Promise<AgentPackager>;
  environment?: Promise<EnvironmentStore>;
  catalogs?: Map<string, Promise<CapabilityCatalog>>;
  authenticator?: Authenticator;
  credentials?: CredentialStore;
  systems?: Promise<AgentSystem[]>;
  /** SQLite stores opened for sqlite:<file> sources (AGENT_SYSTEMS and projects), one per file, closed with the container. */
  systemStores?: Map<string, SqliteStores>;
};
// Survives Next.js dev hot reloads so we keep one database handle, one Mongo pool and one event bus.
const cache = ((globalThis as { __uabContainer?: Cache }).__uabContainer ??= { runners: {}, exporters: {} });
cache.runners ??= {};
cache.exporters ??= {};

async function openSqliteStores() {
  const { createSqliteStores } = await import("@/adapters/sqlite");
  return createSqliteStores(paths.db(), process.env.UAB_SECRET_KEY);
}

function sqlite() {
  cache.sqlite ??= retryable(openSqliteStores(), () => (cache.sqlite = undefined));
  return cache.sqlite;
}

export function agentRepository(): Promise<AgentRepository> {
  cache.repository ??= retryable(createRepository(), () => (cache.repository = undefined));
  return cache.repository;
}

async function createRepository(): Promise<AgentRepository> {
  switch (storeKind()) {
    case "mongo": {
      const { connectMongo, MongoAgentRepository } = await import("@/adapters/persistence/mongo-agent-repository");
      const { db } = await connectMongo(process.env.MONGODB_URI ?? "mongodb://localhost:27017", process.env.MONGODB_DB ?? "ultimate_agent_builder");
      return new MongoAgentRepository(db);
    }
    case "sqlite":
      return (await sqlite()).agents;
    case "lele": {
      const { LeleAgentRepository } = await import("@/adapters/lele/lele-agent-repository");
      return new LeleAgentRepository({
        projectDir: paths.leleProject(),
        globalDir: path.join(os.homedir(), ".lele", "agents"),
        builtinDir: path.join(paths.leleHarness(), "lele_harness", "agents"),
      });
    }
    default: {
      const { FsAgentRepository } = await import("@/adapters/persistence/fs-agent-repository");
      return new FsAgentRepository(paths.agents());
    }
  }
}

/** Where agents live, for messages: a folder, a database file or a Mongo database. */
export function describeStore(): string {
  switch (storeKind()) {
    case "mongo":
      return `mongodb "${process.env.MONGODB_DB ?? "ultimate_agent_builder"}"`;
    case "sqlite":
      return `sqlite ${paths.db()}`;
    case "lele":
      return `lele ${path.join(paths.leleProject(), ".lele", "agents")}`;
    default:
      return paths.agents();
  }
}

export function bundleCodec(): BundleCodec {
  return new FsBundleCodec();
}

/** Releases handles (SQLite) so a CLI process can exit cleanly. */
export async function closeContainer(): Promise<void> {
  if (cache.sqlite) await cache.sqlite.then((stores) => stores.db.close(), () => undefined);
  cache.sqlite = undefined;
  for (const stores of cache.systemStores?.values() ?? []) stores.db.close();
  cache.systemStores = undefined;
  cache.systems = undefined;
}

/** Every agent system configured in AGENT_SYSTEMS, in the order given. Built once per process. */
export function agentSystems(): Promise<AgentSystem[]> {
  cache.systems ??= retryable(buildAgentSystems(), () => (cache.systems = undefined));
  return cache.systems;
}

export async function agentSystem(id: string): Promise<AgentSystem> {
  const found = (await agentSystems()).find((system) => system.info().id === id);
  if (!found) throw new AgentSystemNotFoundError(id);
  return found;
}

const SYSTEM_KIND_NAMES = ["builder", "lele", "fs", "sqlite"];
const SYSTEM_KINDS = "builder, lele:<dir>, fs:<dir>, sqlite:<file>";

async function buildAgentSystems(): Promise<AgentSystem[]> {
  const taken = new Set<string>();
  const systems: AgentSystem[] = [];
  const entries = (process.env.AGENT_SYSTEMS ?? "builder").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const kind = colon === -1 ? entry : entry.slice(0, colon);
    const arg = colon === -1 ? "" : entry.slice(colon + 1).trim();
    if (!SYSTEM_KIND_NAMES.includes(kind)) {
      throw new Error(`AGENT_SYSTEMS: unknown system kind "${kind}" in "${entry}". Valid kinds: ${SYSTEM_KINDS}.`);
    }
    const needsArg = kind !== "builder";
    if (needsArg !== Boolean(arg)) {
      throw new Error(`AGENT_SYSTEMS entry "${entry}" is ${needsArg ? `missing its path (use ${kind}:<path>)` : "not allowed a path"}. Valid kinds: ${SYSTEM_KINDS}.`);
    }
    if (kind === "builder") {
      systems.push(
        new RepositoryAgentSystem(
          { id: uniqueId("builder", taken), label: "Builder", kind: "builder-store", location: describeStore(), editable: true },
          await agentRepository(),
          exporterFor,
          () => capabilityCatalog(),
          (id) => `/agents/${id}`,
        ),
      );
      continue;
    }
    const system = await systemFromSource({ kind, location: arg }, taken);
    if (system) systems.push(system);
  }
  if (systems.length === 0) throw new Error(`AGENT_SYSTEMS is empty. Valid kinds: ${SYSTEM_KINDS}.`);
  return systems;
}

/**
 * One agent system from a source: an AGENT_SYSTEMS entry or a project's `systems` item. Unknown kinds are skipped
 * with a warning (undefined is returned).
 */
export async function systemFromSource(source: SystemSource, taken: Set<string>): Promise<AgentSystem | undefined> {
  const { kind, location } = source;
  switch (kind) {
    case "lele": {
      const projectDir = path.resolve(location);
      const { LeleAgentRepository } = await import("@/adapters/lele/lele-agent-repository");
      const editable = projectDir === path.resolve(paths.leleProject()) && storeKind() === "lele";
      const info: AgentSystemInfo = {
        id: uniqueId("lele", taken),
        label: source.label ?? `lele · ${path.basename(projectDir)}`,
        kind: "lele",
        location: path.join(projectDir, ".lele", "agents"),
        editable,
      };
      const repository = new LeleAgentRepository({
        projectDir,
        globalDir: path.join(os.homedir(), ".lele", "agents"),
        builtinDir: path.join(paths.leleHarness(), "lele_harness", "agents"),
      });
      return new RepositoryAgentSystem(info, repository, exporterFor, () => capabilityCatalog(projectDir), editable ? (id) => `/agents/${id}` : undefined);
    }
    case "fs": {
      const dir = path.resolve(location);
      const { FsAgentRepository } = await import("@/adapters/persistence/fs-agent-repository");
      const info: AgentSystemInfo = {
        id: uniqueId("fs", taken),
        label: source.label ?? `fs · ${path.basename(dir)}`,
        kind: "fs",
        location: dir,
        editable: false,
      };
      return new RepositoryAgentSystem(info, new FsAgentRepository(dir), exporterFor, () => capabilityCatalog());
    }
    case "sqlite": {
      const file = path.resolve(location);
      const stores = await systemStoresFor(file);
      const info: AgentSystemInfo = {
        id: uniqueId("sqlite", taken),
        label: source.label ?? `sqlite · ${path.basename(file)}`,
        kind: "sqlite",
        location: file,
        editable: false,
      };
      return new RepositoryAgentSystem(info, stores.agents, exporterFor, () => capabilityCatalog());
    }
    case "litellm": {
      // The key is a secret: from the process env, else the environment store (Environment page / ENV_SOURCE).
      const apiKey =
        process.env.LITELLM_API_KEY ??
        (await environmentStore()
          .then((store) => store.resolve("development", ["LITELLM_API_KEY"]))
          .then(({ values }) => values.LITELLM_API_KEY)
          .catch(() => undefined));
      const { LiteLlmAgentSystem } = await import("@/adapters/litellm/litellm-agent-system");
      return new LiteLlmAgentSystem({ id: uniqueId("litellm", taken), baseUrl: location, apiKey, label: source.label });
    }
    default:
      console.warn(`Skipping agent system of unknown kind "${kind}" (${location}).`);
      return undefined;
  }
}

/** One SQLite store per file for sqlite systems, shared by AGENT_SYSTEMS and projects; closed with the container. */
async function systemStoresFor(file: string): Promise<SqliteStores> {
  cache.systemStores ??= new Map();
  let stores = cache.systemStores.get(file);
  if (!stores) {
    const { createSqliteStores } = await import("@/adapters/sqlite");
    stores = createSqliteStores(file, process.env.UAB_SECRET_KEY);
    cache.systemStores.set(file, stores);
  }
  return stores;
}

/** "builder", then "builder-2", "builder-3"... so repeated entries keep distinct ids. */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export async function libraryRepository(): Promise<LibraryRepository> {
  return (await sqlite()).library;
}

/** Projects live in the builder's SQLite database. */
export async function projectRepository(): Promise<ProjectRepository> {
  return (await sqlite()).projects;
}

export async function settingsStore(): Promise<SettingsStore> {
  return (await sqlite()).settings;
}

/** A project's own agents: always in SQLite, scoped to the project. Unknown projects throw ProjectNotFoundError. */
export async function projectAgentRepository(projectId: string): Promise<AgentRepository> {
  return (await projectRepository()).agents(projectId);
}

export async function projectAgentService(projectId: string): Promise<AgentService> {
  return new AgentService(await projectAgentRepository(projectId), agentEvents());
}

export async function projectImportService(projectId: string): Promise<ImportService> {
  return new ImportService(await projectAgentService(projectId), await projectAgentRepository(projectId), libraryRepository, exporterFor);
}

/** The project's own agents as an agent system (id "project", editable here). */
export async function projectOwnSystem(projectId: string): Promise<AgentSystem> {
  const project: Project = await (await projectRepository()).get(projectId);
  return new RepositoryAgentSystem(
    {
      id: "project",
      label: project.name,
      kind: "project",
      location: `${paths.db()}#${projectId}`,
      // Agents are imported and inspected here; the spec editor works on the builder store (/agents) for now.
      editable: false,
    },
    await projectAgentRepository(projectId),
    exporterFor,
    () => capabilityCatalog(),
  );
}

/**
 * Every agent system a project shows: its own agents first (system id "project"), then one per entry of its
 * `systems`, built like AGENT_SYSTEMS entries.
 */
export async function projectSystems(projectId: string): Promise<AgentSystem[]> {
  const own = await projectOwnSystem(projectId);
  const project = await (await projectRepository()).get(projectId);
  const taken = new Set<string>([own.info().id]);
  const systems: AgentSystem[] = [own];
  for (const source of project.systems) {
    const system = await systemFromSource(source, taken);
    if (system) systems.push(system);
  }
  return systems;
}

export function environmentStore(): Promise<EnvironmentStore> {
  cache.environment ??= retryable(
    (async () => {
      if (envSourceKind() === "sqlite") return (await sqlite()).environment;
      const { DotenvEnvironmentStore } = await import("@/adapters/dotenv/dotenv-environment-store");
      return new DotenvEnvironmentStore(paths.env());
    })(),
    () => (cache.environment = undefined),
  );
  return cache.environment;
}

export function agentEvents(): AgentEventBus {
  cache.events ??= new MemoryEventBus();
  return cache.events;
}

export function agentService(): Promise<AgentService> {
  cache.service ??= retryable(
    agentRepository().then((repository) => new AgentService(repository, agentEvents())),
    () => (cache.service = undefined),
  );
  return cache.service;
}

export function toolInspector(): ToolInspector {
  cache.inspector ??= new McpToolInspector();
  return cache.inspector;
}

export function agentExporter(runtime: Runtime): AgentExporter {
  if (!cache.exporters[runtime]) {
    if (runtime === "goose") cache.exporters.goose = new GooseExporter();
    else throw new Error("Use agentExporterAsync for lele");
  }
  return cache.exporters[runtime]!;
}

/** The exporter for a runtime: AgentSpec <-> harness-native definition (Goose recipe, lele AGENTS.md). */
export async function exporterFor(runtime: Runtime): Promise<AgentExporter> {
  if (runtime === "goose") return agentExporter("goose");
  const exporter = cache.exporters.lele ?? new (await import("@/adapters/lele/lele-exporter")).LeleExporter();
  cache.exporters.lele = exporter;
  return exporter;
}

export function agentRunner(runtime: Runtime = "goose"): Promise<AgentRunner> {
  cache.runners[runtime] ??= (async (): Promise<AgentRunner> => {
    if (runtime === "lele") {
      if (process.env.LELE_SERVE_URL) {
        const { LeleServeRunner } = await import("@/adapters/lele/lele-serve-runner");
        return new LeleServeRunner(process.env.LELE_SERVE_URL, paths.leleProject());
      }
      const { LeleCliRunner } = await import("@/adapters/lele/lele-cli-runner");
      return new LeleCliRunner(process.env.LELE_BIN ?? "lele", paths.leleProject());
    }
    const { GooseCliRunner } = await import("@/adapters/goose/goose-cli-runner");
    return new GooseCliRunner(process.env.GOOSE_BIN ?? "goose");
  })();
  return cache.runners[runtime]!;
}

export function agentPackager(): Promise<AgentPackager> {
  cache.packager ??= import("@/adapters/docker/docker-packager").then(({ DockerPackager }) => new DockerPackager(process.env.DOCKER_BIN ?? "docker"));
  return cache.packager;
}

export async function importService(): Promise<ImportService> {
  return new ImportService(await agentService(), await agentRepository(), libraryRepository, exporterFor);
}

export function runService(): Promise<RunService> {
  cache.runs ??= retryable(
    (async () => {
      const [agents, environment, lele] = await Promise.all([agentService(), environmentStore(), exporterFor("lele")]);
      return new RunService(agents, { goose: agentExporter("goose"), lele }, agentRunner, environment, { goose: agentPackager });
    })(),
    () => (cache.runs = undefined),
  );
  return cache.runs;
}

/** lele's capabilities as seen from `projectDir` (its project plugins and extensions count). One catalog per project. */
export function capabilityCatalog(projectDir: string = paths.leleProject()): Promise<CapabilityCatalog> {
  const key = path.resolve(projectDir).toLowerCase();
  cache.catalogs ??= new Map();
  let catalog = cache.catalogs.get(key);
  if (!catalog) {
    catalog = import("@/adapters/lele/lele-catalog").then(
      ({ LeleCatalog }) =>
        new LeleCatalog({
          harnessDir: paths.leleHarness(),
          projectDir,
          homeDir: os.homedir(),
          scriptPath: process.env.LELE_INTROSPECT_SCRIPT ?? path.join(process.cwd(), "src", "adapters", "lele", "introspect.py"),
          uvBin: process.env.UV_BIN,
        }),
    );
    cache.catalogs.set(key, catalog);
  }
  return catalog;
}

export function authenticator(): Authenticator {
  cache.authenticator ??= new ApiKeyAuthenticator(parseApiKeys(process.env.UAB_API_KEYS));
  return cache.authenticator;
}

export function credentialStore(): CredentialStore {
  cache.credentials ??= new EnvCredentialStore(process.env);
  return cache.credentials;
}

/** Parses "id:key:scope1|scope2,id2:key2:*". The first field is the id, the last the scopes; the key is everything between. */
export function parseApiKeys(raw: string | undefined): Map<string, ApiKeyGrant> {
  const keys = new Map<string, ApiKeyGrant>();
  for (const entry of (raw ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const fields = entry.split(":");
    if (fields.length < 3) throw new Error(`UAB_API_KEYS entry "${entry.split(":")[0]}" must look like id:key:scope1|scope2.`);
    const id = fields[0].trim();
    const key = fields.slice(1, -1).join(":").trim();
    const scopes = fields[fields.length - 1].split("|").map((scope) => scope.trim()).filter(Boolean);
    if (!id || !key) throw new Error("UAB_API_KEYS entries need a non-empty id and key.");
    if (keys.has(key)) throw new Error(`UAB_API_KEYS contains a duplicate key for "${id}".`);
    keys.set(key, { id, scopes });
  }
  return keys;
}

function retryable<T>(promise: Promise<T>, reset: () => void): Promise<T> {
  return promise.catch((error) => {
    reset();
    throw error;
  });
}
