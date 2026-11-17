import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { ProjectActions } from "@/components/projects/project-actions";
import { ProjectSystems, type SystemRow } from "@/components/projects/project-systems";
import { AgentGraph, type GraphAgent, type GraphEdge } from "@/components/systems/agent-graph";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_PROJECT_ID } from "@/core/projects/project";
import { ProjectNotFoundError } from "@/core/shared/errors";
import type { AgentDescriptor, AgentListing, AgentSystemInfo } from "@/core/systems/agent-system";
import type { AgentSystem } from "@/core/systems/agent-system.port";
import { projectAgentHref } from "@/lib/project-links";
import { projectRepository, projectSystems } from "@/server/container";

type Props = { params: Promise<{ project: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).project };
}

/** A system's agents as listed, or why they couldn't be listed. */
type Loaded = { system: AgentSystem; info: AgentSystemInfo; listings: AgentListing[]; problem?: string };

export default async function ProjectPage({ params }: Props) {
  const { project: projectId } = await params;
  await connection(); // always read the live stores
  const project = await (await projectRepository()).get(projectId).catch(missingProject);
  const [own, ...attached] = await Promise.all((await projectSystems(projectId).catch(missingProject)).map(listSystem));

  // Systems are listed in the order of project.systems; the first one is the project's own agents.
  const rows: SystemRow[] = project.systems.map((source, index) => {
    const loaded = attached[index];
    return {
      source,
      label: loaded?.info.label ?? source.label ?? source.location,
      agents: loaded && !loaded.problem ? loaded.listings.length : undefined,
      problem: loaded ? loaded.problem : "This system is not connected.",
    };
  });

  // The graph needs every agent's sub-agent links. Agents that can't be read are left out of it.
  const graph = await Promise.all(
    [own, ...attached].map(async (loaded) => {
      const described = await Promise.all(
        loaded.listings.filter((listing) => !listing.problem).map((listing) => loaded.system.describe(listing.id).catch(() => undefined)),
      );
      return { loaded, descriptors: described.filter(isDescriptor) };
    }),
  );
  const graphAgents: GraphAgent[] = [];
  const graphEdges: GraphEdge[] = [];
  for (const { loaded, descriptors } of graph) {
    const systemId = loaded.info.id;
    const ids = new Set(descriptors.map((descriptor) => descriptor.id));
    for (const descriptor of descriptors) {
      const node = `${systemId}:${descriptor.id}`;
      graphAgents.push({
        id: node,
        name: descriptor.name,
        capabilityCount: descriptor.capabilities.length,
        href: projectAgentHref(project.id, systemId, descriptor.id),
      });
      for (const link of descriptor.subAgents) {
        if (ids.has(link.id)) graphEdges.push({ from: node, to: `${systemId}:${link.id}`, via: link.via });
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Tooltip>
          <TooltipTrigger render={<h1 className="truncate text-2xl font-semibold" />}>{project.name}</TooltipTrigger>
          <TooltipContent className="max-w-80">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Id</dt>
              <dd className="font-mono break-all">{project.id}</dd>
              {project.description ? (
                <>
                  <dt className="text-muted-foreground">Description</dt>
                  <dd>{project.description}</dd>
                </>
              ) : null}
            </dl>
          </TooltipContent>
        </Tooltip>
        <ProjectActions projectId={project.id} canDelete={project.id !== DEFAULT_PROJECT_ID} />
      </div>

      <Tabs defaultValue="agents" className="gap-0">
        <div className="border-b px-5 py-2">
          <TabsList>
            <TabsTrigger value="agents">
              Agents
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                {own.listings.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="systems">
              Systems
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                {project.systems.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="graph">Graph</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-5">
          <TabsContent value="agents" className="flex flex-col gap-5">
            <AgentRows loaded={own} projectId={project.id} />
            {attached.map((loaded) => (
              <section key={loaded.info.id} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 text-sm font-medium">
                  {loaded.info.label}
                  <Badge variant="outline" className="rounded-full font-mono text-[11px]">
                    {loaded.info.kind}
                  </Badge>
                </h2>
                <AgentRows loaded={loaded} projectId={project.id} />
              </section>
            ))}
          </TabsContent>

          <TabsContent value="systems">
            <ProjectSystems project={{ id: project.id, name: project.name, description: project.description }} rows={rows} />
          </TabsContent>

          <TabsContent value="graph">
            <AgentGraph system={project.id} agents={graphAgents} edges={graphEdges} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function AgentRows({ loaded, projectId }: { loaded: Loaded; projectId: string }) {
  if (loaded.problem) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        {loaded.problem}
      </p>
    );
  }
  if (loaded.listings.length === 0) return <p className="text-sm text-muted-foreground">No agents.</p>;

  return (
    <ul className="divide-y rounded-2xl border bg-background/50">
      {loaded.listings.map((agent) => (
        <li key={agent.id}>
          <Link
            href={projectAgentHref(projectId, loaded.info.id, agent.id)}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-2"
          >
            <span className="w-48 shrink-0 truncate font-medium">{agent.name}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{agent.description ?? ""}</span>
            {agent.model ? (
              <Badge variant="secondary" className="shrink-0 rounded-full font-mono">
                {agent.model}
              </Badge>
            ) : null}
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                <Badge variant="outline" className="rounded-full tabular-nums">
                  {agent.capabilityCount}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{agent.capabilityCount === 1 ? "1 capability" : `${agent.capabilityCount} capabilities`}</TooltipContent>
            </Tooltip>
            {agent.problem ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                  <Badge variant="destructive" className="rounded-full">
                    <AlertTriangle /> Problem
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">{agent.problem}</TooltipContent>
              </Tooltip>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function listSystem(system: AgentSystem): Promise<Loaded> {
  const info = system.info();
  try {
    return { system, info, listings: await system.list() };
  } catch (error) {
    return { system, info, listings: [], problem: error instanceof Error ? error.message : String(error) };
  }
}

function isDescriptor(descriptor: AgentDescriptor | undefined): descriptor is AgentDescriptor {
  return descriptor !== undefined;
}

function missingProject(error: unknown): never {
  if (error instanceof ProjectNotFoundError) notFound();
  throw error;
}
