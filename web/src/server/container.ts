import "server-only";

import path from "node:path";
import type { Authenticator } from "@/core/auth/authenticator.port";
import type { CredentialStore } from "@/core/auth/credential-store.port";
import type { AgentEventBus } from "@/core/agents/agent-events.port";
import type { AgentRepository } from "@/core/agents/agent-repository.port";
import { AgentService } from "@/core/agents/agent-service";
import type { AgentPackager } from "@/core/runtime/agent-packager.port";
import type { AgentRunner } from "@/core/runtime/agent-runner.port";
import type { ToolInspector } from "@/core/tools/tool-inspector.port";
import { MemoryEventBus } from "@/adapters/events/memory-event-bus";
import { McpToolInspector } from "@/adapters/mcp/mcp-tool-inspector";
import { ApiKeyAuthenticator, type ApiKeyGrant } from "@/adapters/auth/api-key-authenticator";
import { EnvCredentialStore } from "@/adapters/auth/env-credential-store";

/**
 * Composition root: the only place that knows which adapter backs each port.
 *   AGENT_STORE=fs (default)  YAML files in AGENTS_DIR (default ../agents)
 *   AGENT_STORE=mongo         MONGODB_URI / MONGODB_DB
 *   GOOSE_BIN                 goose executable for runs (default "goose")
 *   DOCKER_BIN                docker executable for image builds (default "docker")
 *   UAB_API_KEYS              "id:key:scope1|scope2,id2:key2:*" (empty = auth disabled, dev mode)
 */

export type StoreKind = "fs" | "mongo";

export function storeKind(): StoreKind {
  return process.env.AGENT_STORE === "mongo" ? "mongo" : "fs";
}

type Cache = {
  repository?: Promise<AgentRepository>;
  service?: Promise<AgentService>;
  events?: AgentEventBus;
  inspector?: ToolInspector;
  runner?: Promise<AgentRunner>;
  packager?: Promise<AgentPackager>;
  authenticator?: Authenticator;
  credentials?: CredentialStore;
};
// Survives Next.js dev hot reloads so we keep one Mongo pool and one event bus.
const cache = ((globalThis as { __uabContainer?: Cache }).__uabContainer ??= {});

export function agentRepository(): Promise<AgentRepository> {
  cache.repository ??= retryable(createRepository(), () => (cache.repository = undefined));
  return cache.repository;
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

export function agentRunner(): Promise<AgentRunner> {
  cache.runner ??= import("@/adapters/goose/goose-cli-runner").then(
    ({ GooseCliRunner }) => new GooseCliRunner(process.env.GOOSE_BIN ?? "goose"),
  );
  return cache.runner;
}

export function agentPackager(): Promise<AgentPackager> {
  cache.packager ??= import("@/adapters/docker/docker-packager").then(
    ({ DockerPackager }) => new DockerPackager(process.env.DOCKER_BIN ?? "docker"),
  );
  return cache.packager;
}

async function createRepository(): Promise<AgentRepository> {
  if (storeKind() === "mongo") {
    const { connectMongo, MongoAgentRepository } = await import("@/adapters/persistence/mongo-agent-repository");
    const { db } = await connectMongo(
      process.env.MONGODB_URI ?? "mongodb://localhost:27017",
      process.env.MONGODB_DB ?? "ultimate_agent_builder",
    );
    return new MongoAgentRepository(db);
  }
  const { FsAgentRepository } = await import("@/adapters/persistence/fs-agent-repository");
  return new FsAgentRepository(process.env.AGENTS_DIR ?? path.resolve(process.cwd(), "..", "agents"));
}

export function authenticator(): Authenticator {
  cache.authenticator ??= new ApiKeyAuthenticator(parseApiKeys(process.env.UAB_API_KEYS));
  return cache.authenticator;
}

export function credentialStore(): CredentialStore {
  cache.credentials ??= new EnvCredentialStore(process.env);
  return cache.credentials;
}

/**
 * Parses "id:key:scope1|scope2,id2:key2:*". Entries are comma-separated, so keys must not contain ",";
 * keys must not contain ":" either (the first two colons delimit id and key); scopes may.
 */
export function parseApiKeys(raw: string | undefined): Map<string, ApiKeyGrant> {
  const keys = new Map<string, ApiKeyGrant>();
  for (const entry of (raw ?? "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const idEnd = entry.indexOf(":");
    const keyEnd = idEnd === -1 ? -1 : entry.indexOf(":", idEnd + 1);
    if (keyEnd === -1) {
      throw new Error(`UAB_API_KEYS entry "${entry.split(":")[0]}" must look like id:key:scope1|scope2.`);
    }
    const id = entry.slice(0, idEnd).trim();
    const key = entry.slice(idEnd + 1, keyEnd).trim();
    const scopes = entry.slice(keyEnd + 1).split("|").map((scope) => scope.trim()).filter(Boolean);
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
