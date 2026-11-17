/** Port: package an agent as a deployable image. Adapter: Docker (Dockerfile + `docker build`). */

export interface BuildContext {
  /** Files written into the build context, path -> contents. Must include "Dockerfile". */
  files: Record<string, string>;
}

export interface PackageRequest {
  agentId: string;
  /** Harness-native definition, e.g. a Goose recipe as YAML. */
  definition: string;
  tag: string;
}

export type BuildEvent =
  | { type: "build.started"; tag: string; contextDir: string; at: string }
  | { type: "build.output"; text: string }
  | { type: "build.finished"; tag: string; exitCode: number | null; durationMs: number }
  | { type: "build.failed"; message: string };

export interface AgentPackager {
  /** The build context without building, for download or inspection. */
  context(request: PackageRequest): BuildContext;
  build(request: PackageRequest, signal: AbortSignal): AsyncIterable<BuildEvent>;
}
