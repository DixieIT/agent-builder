import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentSystem } from "@/core/systems/agent-system.port";
import { agentSystems } from "@/server/container";

export const metadata: Metadata = { title: "Systems" };

type Count = { agents: number } | { problem: string };

async function countAgents(system: AgentSystem): Promise<Count> {
  try {
    return { agents: (await system.list()).length };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

export default async function SystemsPage() {
  await connection(); // always read the live stores
  const systems = await agentSystems();
  const counts = await Promise.all(systems.map(countAgents));

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <h1 className="text-lg font-semibold">Systems</h1>
        <span className="text-sm text-muted-foreground">{systems.length}</span>
      </div>

      {systems.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No agent systems are configured.</p>
      ) : (
        <ul className="divide-y">
          {systems.map((system, index) => {
            const info = system.info();
            const count = counts[index];
            return (
              <li key={info.id}>
                <Link
                  href={`/systems/${encodeURIComponent(info.id)}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-2"
                >
                  <Tooltip>
                    <TooltipTrigger render={<span className="min-w-0 truncate font-medium" />}>{info.label}</TooltipTrigger>
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
                  <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                    {"problem" in count ? (
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex text-destructive" aria-label="Unavailable" />}>
                          <AlertTriangle className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-72">{count.problem}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger render={<span className="tabular-nums" />}>{count.agents}</TooltipTrigger>
                        <TooltipContent>{count.agents === 1 ? "1 agent" : `${count.agents} agents`}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
