import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentEditor, type LeleContext } from "@/components/agents/editor";
import { RepairAgent } from "@/components/agents/repair-agent";
import { AgentNotFoundError, InvalidAgentDocumentError, InvalidAgentIdError } from "@/core/shared/errors";
import { agentService, runService, runtimeCatalog } from "@/server/container";


type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).id };
}

export default async function AgentPage({ params }: Props) {
  const { id } = await params;
  await connection(); // always read the live store
  const service = await agentService();
  const loaded = await service.get(id).then(
    (record) => ({ record }) as const,
    (error: unknown) => {
      if (error instanceof AgentNotFoundError || error instanceof InvalidAgentIdError) notFound();
      if (error instanceof InvalidAgentDocumentError) return { broken: error } as const;
      throw error;
    },
  );
  if ("broken" in loaded) {
    return <RepairAgent id={id} issues={loaded.broken.issues} raw={loaded.broken.raw ?? ""} />;
  }
  const { record } = loaded;
  let lele: LeleContext | undefined;
  if (record.spec.runtime === "lele") {
    const [catalog, exported] = await Promise.all([runtimeCatalog(), runService().then((runs) => runs.export(record.id))]);
    const [toolGroups, skills] = await Promise.all([catalog.toolGroups(), catalog.skills()]);
    lele = { toolGroups, skills, limitations: catalog.limitations(), definition: exported.definition };
  }
  return <AgentEditor id={record.id} spec={record.spec} updatedAt={record.updatedAt.toISOString()} lele={lele} />;
}
