import type { AgentRepository, ProvisionableStore } from "../src/core/agents/agent-repository.port";
import type { AgentService } from "../src/core/agents/agent-service";
import type { Runtime } from "../src/core/agents/agent-spec";
import type { EnvironmentStore } from "../src/core/environment/environment-store.port";
import type { BundleCodec } from "../src/core/library/bundle.port";
import type { LibraryRepository } from "../src/core/library/library-repository.port";
import type { AgentExporter } from "../src/core/runtime/agent-exporter.port";
import type { AgentRunner } from "../src/core/runtime/agent-runner.port";
import type { RunService } from "../src/core/runtime/run-service";
import type { ImportService } from "../src/core/library/import-service";
import * as container from "../src/server/container";

/**
 * The CLI uses the app's composition root (`src/server/container.ts`), so one place decides every adapter.
 * It runs under `--conditions react-server` (see package.json), where `server-only` is an empty module.
 */

export interface CliOverrides {
  uri?: string;
  db?: string;
}

export interface CliComposition {
  store: container.StoreKind;
  label: string;
  service: AgentService;
  repository: AgentRepository;
  /** Set when the agent store can be verified/provisioned (mongo, sqlite). */
  provisionable?: ProvisionableStore;
  bundle: BundleCodec;
  library(): Promise<LibraryRepository>;
  environment(): Promise<EnvironmentStore>;
  runs(): Promise<RunService>;
  runner(runtime: Runtime): Promise<AgentRunner>;
  exporter(runtime: Runtime): Promise<AgentExporter>;
  importer(): Promise<ImportService>;
  close(): Promise<void>;
}

export async function compose(overrides: CliOverrides = {}): Promise<CliComposition> {
  if (overrides.uri) process.env.MONGODB_URI = overrides.uri;
  if (overrides.db) process.env.MONGODB_DB = overrides.db;
  const repository = await container.agentRepository();
  return {
    store: container.storeKind(),
    label: container.describeStore(),
    service: await container.agentService(),
    repository,
    provisionable: isProvisionable(repository) ? repository : undefined,
    bundle: container.bundleCodec(),
    library: container.libraryRepository,
    environment: container.environmentStore,
    runs: container.runService,
    runner: container.agentRunner,
    exporter: container.exporterFor,
    importer: container.importService,
    close: container.closeContainer,
  };
}

function isProvisionable(value: unknown): value is ProvisionableStore {
  const candidate = value as Partial<ProvisionableStore>;
  return typeof candidate.verify === "function" && typeof candidate.provision === "function";
}
