import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AgentEditor, type LeleContext } from "@/components/agents/editor";
import { RepairAgent } from "@/components/agents/repair-agent";
import { AgentNotFoundError, InvalidAgentDocumentError, InvalidAgentIdError } from "@/core/shared/errors";
import type { Capability } from "@/core/capabilities/capability";
import type { RuntimeSkill } from "@/core/capabilities/capability-catalog.port";
import { agentService, capabilityCatalog, runService } from "@/server/container";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeLimitations(catalog: { limitations(): string[] }): string[] {
  try {
    return catalog.limitations();
  } catch {
    return [];
  }
}

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
    const [catalog, exported] = await Promise.all([capabilityCatalog(), runService().then((runs) => runs.export(record.id))]);
    // The harness may be missing or fail to boot: the editor still renders, with the reason stated.
    const [capabilities, floor, skills] = await Promise.all([
      catalog.capabilities().then(
        (list) => ({ list, error: undefined }),
        (error: unknown) => ({ list: [] as Capability[], error: errorMessage(error) }),
      ),
      catalog.grantFloor().catch(() => [] as string[]),
      catalog.skills().catch(() => [] as RuntimeSkill[]),
    ]);
    const limitations = safeLimitations(catalog);
    lele = {
      capabilities: capabilities.list,
      floor,
      skills,
      limitations,
      definition: exported.definition,
      ...(capabilities.error === undefined ? {} : { catalogError: capabilities.error }),
    };
  }
  return <AgentEditor id={record.id} spec={record.spec} updatedAt={record.updatedAt.toISOString()} lele={lele} />;
}
