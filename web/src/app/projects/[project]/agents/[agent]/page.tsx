import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentInspector } from "@/components/systems/agent-inspector";
import { ProjectNotFoundError } from "@/core/shared/errors";
import { OWN_SYSTEM_ID, projectAgentHref } from "@/lib/project-links";
import { projectSystems } from "@/server/container";

type Props = {
  params: Promise<{ project: string; agent: string }>;
  /** `?system=<id>` inspects an agent of an attached system; without it, the project's own agents. */
  searchParams: Promise<{ system?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).agent };
}

export default async function ProjectAgentPage({ params, searchParams }: Props) {
  const { project: projectId, agent: agentId } = await params;
  const { system: query } = await searchParams;
  await connection(); // always read the live stores
  const systemId = typeof query === "string" ? query : OWN_SYSTEM_ID;
  const systems = await projectSystems(projectId).catch((error: unknown) => {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  });
  const system = systems.find((candidate) => candidate.info().id === systemId);
  if (!system) notFound();

  return (
    <AgentInspector
      system={system}
      agentId={agentId}
      backHref={`/projects/${encodeURIComponent(projectId)}`}
      hrefFor={(id) => projectAgentHref(projectId, systemId, id)}
    />
  );
}
