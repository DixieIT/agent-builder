import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, Blocks } from "lucide-react";
import { NewAgentDialog } from "@/components/agents/new-agent-dialog";
import { ImportAgentDialog } from "@/components/agents/import-agent-dialog";
import { Badge } from "@/components/ui/badge";
import { agentService, storeKind } from "@/server/container";

export const metadata: Metadata = { title: "Agents" };

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(date: Date): string {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export default async function AgentsPage() {
  await connection(); // always read the live store
  const service = await agentService();
  const agents = await service.list();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-semibold" title={`${agents.length} in the ${storeKind() === "fs" ? "file" : "MongoDB"} store`}>
          Agents
        </h1>
        <div className="flex gap-2">
          <ImportAgentDialog />
          <NewAgentDialog />
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Blocks className="size-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">No agents yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Create an agent from scratch, or import a Pydantic AI agent spec or a Goose recipe.
            </p>
          </div>
          <div className="flex gap-2">
            <ImportAgentDialog />
            <NewAgentDialog />
          </div>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id}>
              <Link
                href={`/agents/${agent.id}`}
                title={`${agent.id} · updated ${ago(agent.updatedAt)}`}
                className="group flex h-full flex-col gap-3 rounded-2xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 truncate font-heading text-lg font-semibold">{agent.name}</h2>
                  {agent.problem ? (
                    <Badge variant="destructive" className="shrink-0 rounded-full">
                      <AlertTriangle /> Needs repair
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                  {agent.problem ?? (agent.description || "No description")}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
                  {agent.model ? (
                    <Badge variant="secondary" className="rounded-full font-mono">
                      {agent.model}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="rounded-full" title="Capabilities">
                    {agent.capabilityCount}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
