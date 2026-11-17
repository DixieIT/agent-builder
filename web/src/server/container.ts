import "server-only";

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
import type { RuntimeCatalog } from "@/core/runtime/runtime-catalog.port";
import { RunService } from "@/core/runtime/run-service";
import type { BundleCodec } from "@/core/library/bundle.port";
import { FsBundleCodec } from "@/adapters/bundle/fs-bundle-codec";
import type { ToolInspector } from "@/core/tools/tool-inspector.port";
import { ApiKeyAuthenticator, type ApiKeyGrant } from "@/adapters/auth/api-key-authenticator";
import { EnvCredentialStore } from "@/adapters/auth/env-credential-store";
import { MemoryEventBus } from "@/adapters/events/memory-event-bus";
import { GooseExporter } from "@/adapters/goose/goose-exporter";
import { McpToolInspector } from "@/adapters/mcp/mcp-tool-inspector";

/**
 * Composition root: the only place that knows which adapter backs each port.
 *   AGENT_STORE   fs (default, AGENTS_DIR) | sqlite (UAB_DB) | mongo (MONGODB_URI, MONGODB_DB) | lele (LELE_PROJECT_DIR)
 *   ENV_SOURCE    folder (default, ENV_DIR with .env.<environment> files) | sqlite (UAB_DB, encrypted with UAB_SECRET_KEY)
 *   UAB_DB        SQLite file for the library (always) and for sqlite stores; default <repo>/data/uab.sqlite
 *   GOOSE_BIN, DOCKER_BIN, LELE_BIN, LELE_SERVE_URL, LELE_HARNESS_DIR
 *   UAB_API_KEYS  "id:key:scope1|scope2,id2:key2:*" (empty = auth disabled, dev mode)
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
  catalog?: Promise<RuntimeCatalog>;
  authenticator?: Authenticator;
  credentials?: CredentialStore;
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
}

export async function libraryRepository(): Promise<LibraryRepository> {
  return (await sqlite()).library;
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

async function exporterFor(runtime: Runtime): Promise<AgentExporter> {
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

export function runtimeCatalog(): Promise<RuntimeCatalog> {
  cache.catalog ??= import("@/adapters/lele/lele-catalog").then(
    ({ LeleCatalog }) =>
      new LeleCatalog({ harnessDir: paths.leleHarness(), projectDir: paths.leleProject(), homeDir: os.homedir(), serveUrl: process.env.LELE_SERVE_URL }),
  );
  return cache.catalog;
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
