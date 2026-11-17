import path from "node:path";
import { AgentService } from "../src/core/agents/agent-service";
import type { AgentRepository } from "../src/core/agents/agent-repository.port";
import type { AgentRunner } from "../src/core/runtime/agent-runner.port";
import type { CredentialStore } from "../src/core/auth/credential-store.port";
import { MemoryEventBus } from "../src/adapters/events/memory-event-bus";
import { EnvCredentialStore } from "../src/adapters/auth/env-credential-store";
import { FsAgentRepository } from "../src/adapters/persistence/fs-agent-repository";
import { connectMongo, MongoAgentRepository } from "../src/adapters/persistence/mongo-agent-repository";

/**
 * Composition root for the CLI. Mirrors `src/server/container.ts` without its Next.js dependencies
 * (the CLI runs under `--conditions react-server`, see package.json). Keep the two in step.
 */

export interface CliOverrides {
  uri?: string;
  db?: string;
}

export interface CliComposition {
  store: "fs" | "mongo";
  /** Where the agents live, for messages: a directory or "mongodb <db>". */
  label: string;
  service: AgentService;
  repository: AgentRepository;
  /** Set only for the mongo store; verify/init need it. */
  mongo?: MongoAgentRepository;
  credentials: CredentialStore;
  /** The goose adapter is loaded on first use so that `list` does not need it. */
  runner(): Promise<AgentRunner>;
  close(): Promise<void>;
}

export async function compose(overrides: CliOverrides = {}): Promise<CliComposition> {
  const store = process.env.AGENT_STORE === "mongo" ? "mongo" : "fs";
  const events = new MemoryEventBus();

  let repository: AgentRepository;
  let mongo: MongoAgentRepository | undefined;
  let label: string;
  let close: () => Promise<void> = async () => undefined;

  if (store === "mongo") {
    const uri = overrides.uri ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017";
    const dbName = overrides.db ?? process.env.MONGODB_DB ?? "ultimate_agent_builder";
    const connection = await connectMongo(uri, dbName);
    mongo = new MongoAgentRepository(connection.db);
    repository = mongo;
    label = `mongodb "${dbName}"`;
    close = () => connection.client.close();
  } else {
    const dir = process.env.AGENTS_DIR ?? path.resolve(import.meta.dir, "..", "..", "agents");
    repository = new FsAgentRepository(dir);
    label = dir;
  }

  return {
    store,
    label,
    service: new AgentService(repository, events),
    repository,
    mongo,
    credentials: new EnvCredentialStore(process.env),
    async runner() {
      const { GooseCliRunner } = await import("../src/adapters/goose/goose-cli-runner");
      return new GooseCliRunner(process.env.GOOSE_BIN ?? "goose");
    },
    close,
  };
}
