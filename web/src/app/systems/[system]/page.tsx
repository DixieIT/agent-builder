import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { AgentGraph, type GraphAgent, type GraphEdge } from "@/components/systems/agent-graph";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentSystemNotFoundError } from "@/core/shared/errors";
import type { AgentDescriptor } from "@/core/systems/agent-system";
import { agentSystem } from "@/server/container";

type Props = { params: Promise<{ system: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).system };
}

export default async function SystemPage({ params }: Props) {
  const { system: systemId } = await params;
  await connection(); // always read the live stores
  const system = await agentSystem(systemId).catch((error: unknown) => {
    if (error instanceof AgentSystemNotFoundError) notFound();
    throw error;
  });
  const info = system.info();
  const listings = await system.list();

  // The graph needs every agent's sub-agent links. Agents that can't be read are left out of it.
  const descriptors = (
    await Promise.all(
      listings.filter((listing) => !listing.problem).map((listing) => system.describe(listing.id).catch(() => undefined)),
    )
  ).filter((descriptor): descriptor is AgentDescriptor => descriptor !== undefined);
  const ids = new Set(descriptors.map((descriptor) => descriptor.id));
  const graphAgents: GraphAgent[] = descriptors.map((descriptor) => ({
    id: descriptor.id,
    name: descriptor.name,
    capabilityCount: descriptor.capabilities.length,
  }));
  const graphEdges: GraphEdge[] = descriptors.flatMap((descriptor) =>
    descriptor.subAgents
      .filter((link) => ids.has(link.id))
      .map((link) => ({ from: descriptor.id, to: link.id, via: link.via })),
  );

  const base = `/systems/${encodeURIComponent(info.id)}`;

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Tooltip>
          <TooltipTrigger render={<h1 className="truncate text-2xl font-semibold" />}>{info.label}</TooltipTrigger>
          <TooltipContent>{info.location}</TooltipContent>
        </Tooltip>
        <Badge variant="outline" className="rounded-full font-mono text-[11px]">
          {info.kind}
        </Badge>
        {info.editable ? (
          <Badge variant="secondary" className="rounded-full">
            Editable
          </Badge>
        ) : null}
      </div>

      <Tabs defaultValue="agents" className="gap-0">
        <div className="border-b px-5 py-2">
          <TabsList>
            <TabsTrigger value="agents">
              Agents
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                {listings.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="graph">Graph</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-5">
          <TabsContent value="agents">
            {listings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents in this system.</p>
            ) : (
              <ul className="divide-y rounded-2xl border bg-background/50">
                {listings.map((agent) => (
                  <li key={agent.id}>
                    <Link
                      href={`${base}/${encodeURIComponent(agent.id)}`}
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
                        <TooltipContent>
                          {agent.capabilityCount === 1 ? "1 capability" : `${agent.capabilityCount} capabilities`}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                          <Badge variant="outline" className="rounded-full tabular-nums">
                            {agent.subAgentCount}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {agent.subAgentCount === 1 ? "1 sub-agent" : `${agent.subAgentCount} sub-agents`}
                        </TooltipContent>
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
            )}
          </TabsContent>

          <TabsContent value="graph">
            <AgentGraph system={info.id} agents={graphAgents} edges={graphEdges} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
