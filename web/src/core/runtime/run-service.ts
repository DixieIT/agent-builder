import type { AgentService } from "@/core/agents/agent-service";
import { requiredEnvKeys, type AgentSpec, type Runtime } from "@/core/agents/agent-spec";
import type { Environment } from "@/core/environment/environment";
import type { EnvironmentStore } from "@/core/environment/environment-store.port";
import { RuntimeUnavailableError } from "@/core/shared/errors";
import type { AgentExporter, ExportedAgent } from "./agent-exporter.port";
import type { AgentPackager, BuildContext, BuildEvent } from "./agent-packager.port";
import type { AgentRunner, RunEvent } from "./agent-runner.port";

export interface RunOptions {
  params: Record<string, string>;
  prompt?: string;
  environment: Environment;
}

/**
 * Application service: export, run and package agents on their own runtime, with environment variables
 * resolved from the environment store. The API, server actions and CLI all go through here.
 */
export class RunService {
  constructor(
    private readonly agents: AgentService,
    private readonly exporters: Record<Runtime, AgentExporter>,
    private readonly runners: (runtime: Runtime) => Promise<AgentRunner>,
    private readonly environment: EnvironmentStore,
    private readonly packagers: Partial<Record<Runtime, () => Promise<AgentPackager>>>,
  ) {}

  async export(id: string): Promise<ExportedAgent & { spec: AgentSpec }> {
    const { spec } = await this.agents.get(id);
    return { ...this.exporters[spec.runtime].export(spec), spec };
  }

  async *run(id: string, options: RunOptions, signal: AbortSignal): AsyncIterable<RunEvent> {
    const exported = await this.export(id);
    const { values, missing } = await this.environment.resolve(options.environment, requiredEnvKeys(exported.spec));
    if (missing.length) {
      yield { type: "run.output", stream: "stderr", text: `Missing in ${options.environment}: ${missing.join(", ")}\n` };
    }
    const runner = await this.runners(exported.spec.runtime);
    yield* runner.run(
      { name: exported.name, definition: exported.definition, env: values, params: options.params, prompt: options.prompt },
      signal,
    );
  }

  async buildContext(id: string, tag?: string): Promise<BuildContext> {
    const exported = await this.export(id);
    const packager = await this.packager(exported.spec.runtime);
    return packager.context({ agentId: id, definition: exported.definition, tag: tag ?? defaultTag(id) });
  }

  async *build(id: string, tag: string | undefined, signal: AbortSignal): AsyncIterable<BuildEvent> {
    const exported = await this.export(id);
    const packager = await this.packager(exported.spec.runtime);
    yield* packager.build({ agentId: id, definition: exported.definition, tag: tag ?? defaultTag(id) }, signal);
  }

  private packager(runtime: Runtime): Promise<AgentPackager> {
    const factory = this.packagers[runtime];
    if (!factory) throw new RuntimeUnavailableError(`Container images aren't available for ${runtime} agents yet.`);
    return factory();
  }
}

function defaultTag(id: string): string {
  return `uab/${id}:latest`;
}
