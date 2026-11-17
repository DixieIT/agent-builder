import type { ProvisionableStore } from "../src/core/agents/agent-repository.port";
import type { AgentService } from "../src/core/agents/agent-service";
import type { Runtime } from "../src/core/agents/agent-spec";
import type { EnvironmentStore } from "../src/core/environment/environment-store.port";
import type { BundleCodec } from "../src/core/library/bundle.port";
import type { LibraryRepository } from "../src/core/library/library-repository.port";
import type { AgentExporter } from "../src/core/runtime/agent-exporter.port";
import type { AgentRunner } from "../src/core/runtime/agent-runner.port";
import type { RunService } from "../src/core/runtime/run-service";
import type { AgentSystem } from "../src/core/systems/agent-system.port";
import type { ImportService } from "../src/core/library/import-service";
import type { ProjectRepository, SettingsStore } from "../src/core/projects/project-repository.port";
import * as container from "../src/server/container";

/**
 * The CLI uses the app's composition root (`src/server/container.ts`), so one place decides every adapter.
 * It runs under `--conditions react-server` (see package.json), where `server-only` is an empty module.
 * Stores are opened on first use, so `config` and `projects` do not connect to MongoDB or open the agent store.
 */

export interface CliOverrides {
  uri?: string;
  db?: string;
}

export interface CliComposition {
  store: container.StoreKind;
  label: string;
  service(): Promise<AgentService>;
  /** Set when the agent store can be verified/provisioned (mongo, sqlite). */
  provisionable(): Promise<ProvisionableStore | undefined>;
  bundle: BundleCodec;
  library(): Promise<LibraryRepository>;
  environment(): Promise<EnvironmentStore>;
  runs(): Promise<RunService>;
  runner(runtime: Runtime): Promise<AgentRunner>;
  exporter(runtime: Runtime): Promise<AgentExporter>;
  importer(): Promise<ImportService>;
  /** Agent systems from AGENT_SYSTEMS (builder, lele projects, folders, SQLite stores). */
  systems(): Promise<AgentSystem[]>;
  system(id: string): Promise<AgentSystem>;
  /** Saved settings (`config set`), kept apart from environment variables. */
  settings(): Promise<SettingsStore>;
  projects(): Promise<ProjectRepository>;
  /** Imports into a project's own agent store. */
  projectImporter(projectId: string): Promise<ImportService>;
  /** The agent systems a project connects to. */
  projectSystems(projectId: string): Promise<AgentSystem[]>;
  close(): Promise<void>;
}

export async function compose(overrides: CliOverrides = {}): Promise<CliComposition> {
  if (overrides.uri) process.env.MONGODB_URI = overrides.uri;
  if (overrides.db) process.env.MONGODB_DB = overrides.db;
  return {
    store: container.storeKind(),
    label: container.describeStore(),
    service: () => container.agentService(),
    provisionable: async () => {
      const repository = await container.agentRepository();
      return isProvisionable(repository) ? repository : undefined;
    },
    bundle: container.bundleCodec(),
    library: container.libraryRepository,
    environment: container.environmentStore,
    runs: container.runService,
    runner: container.agentRunner,
    exporter: container.exporterFor,
    importer: container.importService,
    systems: container.agentSystems,
    system: container.agentSystem,
    settings: container.settingsStore,
    projects: container.projectRepository,
    projectImporter: container.projectImportService,
    projectSystems: container.projectSystems,
    close: container.closeContainer,
  };
}

function isProvisionable(value: unknown): value is ProvisionableStore {
  const candidate = value as Partial<ProvisionableStore>;
  return typeof candidate.verify === "function" && typeof candidate.provision === "function";
}
