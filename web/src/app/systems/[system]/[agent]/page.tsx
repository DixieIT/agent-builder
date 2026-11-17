import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentInspector } from "@/components/systems/agent-inspector";
import { AgentSystemNotFoundError } from "@/core/shared/errors";
import { agentSystem } from "@/server/container";

type Props = { params: Promise<{ system: string; agent: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).agent };
}

export default async function AgentPage({ params }: Props) {
  const { system: systemId, agent: agentId } = await params;
  await connection(); // always read the live stores
  const system = await agentSystem(systemId).catch((error: unknown) => {
    if (error instanceof AgentSystemNotFoundError) notFound();
    throw error;
  });
  const base = `/systems/${encodeURIComponent(system.info().id)}`;

  return (
    <AgentInspector
      system={system}
      agentId={agentId}
      backHref={base}
      hrefFor={(id) => `${base}/${encodeURIComponent(id)}`}
    />
  );
}
