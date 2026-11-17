import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentEditor } from "@/components/agents/editor/agent-editor";
import { RepairAgent } from "@/components/agents/repair-agent";
import { AgentNotFoundError, InvalidAgentDocumentError, InvalidAgentIdError } from "@/core/shared/errors";
import { agentService } from "@/server/container";


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
  return <AgentEditor id={record.id} initialSpec={record.spec} updatedAt={record.updatedAt.toISOString()} />;
}
