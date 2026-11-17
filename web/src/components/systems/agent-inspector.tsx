import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Pencil } from "lucide-react";
import { Fragment } from "react";
import { Hint } from "@/components/agents/editor/fields";
import { ToolInspector } from "@/components/agents/tool-inspector";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CapabilityTool } from "@/core/capabilities/capability";
import type { ToolAccess } from "@/core/capabilities/lele-access";
import type { McpServerArgs } from "@/core/agents/agent-spec";
import { AgentNotFoundError } from "@/core/shared/errors";
import type { AgentSystem } from "@/core/systems/agent-system.port";
import type { CapabilityView } from "@/core/systems/agent-system";
import type { JsonSchemaProperty } from "@/core/tools/tool-inspector.port";
import { cn } from "@/lib/utils";

/**
 * One agent of any agent system, inspected: capabilities, instructions, skills, sub-agents, source.
 * Used by the systems routes and the project routes; the caller decides where links go.
 */
export async function AgentInspector({
  system,
  agentId,
  backHref,
  hrefFor,
}: {
  system: AgentSystem;
  agentId: string;
  /** Where the back arrow goes. */
  backHref: string;
  /** URL of another agent in the same system (sub-agent links). */
  hrefFor: (agentId: string) => string;
}) {
  const descriptor = await system.describe(agentId).catch((error: unknown) => {
    if (error instanceof AgentNotFoundError) notFound();
    throw error;
  });
  const info = system.info();
  const names = new Map((await system.list()).map((listing) => [listing.id, listing.name]));
  const skills = descriptor.skills ?? [];

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <Tooltip>
          <TooltipTrigger
            render={<Link href={backHref} aria-label={`Back to ${info.label}`} className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "rounded-full")} />}
          >
            <ArrowLeft />
          </TooltipTrigger>
          <TooltipContent>{info.label}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<h1 className="truncate text-2xl font-semibold" />}>{descriptor.name}</TooltipTrigger>
          <TooltipContent className="max-w-80">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Id</dt>
              <dd className="font-mono break-all">{descriptor.id}</dd>
              <dt className="text-muted-foreground">System</dt>
              <dd>{info.label}</dd>
              {descriptor.description ? (
                <>
                  <dt className="text-muted-foreground">Description</dt>
                  <dd>{descriptor.description}</dd>
                </>
              ) : null}
              {descriptor.facts.map((fact) => (
                <Fragment key={fact.label}>
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="break-all">{fact.value}</dd>
                </Fragment>
              ))}
            </dl>
          </TooltipContent>
        </Tooltip>
        {descriptor.model ? (
          <Badge variant="secondary" className="rounded-full font-mono">
            {descriptor.model}
          </Badge>
        ) : null}
        {descriptor.editPath ? (
          <Tooltip>
            <TooltipTrigger
              render={<Link href={descriptor.editPath} aria-label="Edit" className={cn(buttonVariants({ size: "icon" }), "ml-auto rounded-full")} />}
            >
              <Pencil />
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <Tabs defaultValue="capabilities" className="gap-0">
        <div className="border-b px-5 py-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="capabilities">
              Capabilities
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                {descriptor.capabilities.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            {skills.length ? (
              <TabsTrigger value="skills">
                Skills
                <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                  {skills.length}
                </Badge>
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="sub-agents">
              Sub-agents
              <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px] tabular-nums">
                {descriptor.subAgents.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="source">Source</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-5">
          <TabsContent value="capabilities" className="flex flex-col gap-3">
            {descriptor.capabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">This agent has no capabilities.</p>
            ) : (
              descriptor.capabilities.map((view) => <CapabilitySection key={view.capability.id} view={view} />)
            )}
          </TabsContent>

          <TabsContent value="instructions">
            <div className="rounded-2xl border bg-background/50 p-4">
              {descriptor.instructions ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{descriptor.instructions}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No instructions.</p>
              )}
            </div>
          </TabsContent>

          {skills.length ? (
            <TabsContent value="skills">
              <ul className="divide-y rounded-2xl border bg-background/50">
                {skills.map((skill) => (
                  <li key={skill.id} className="flex min-w-0 items-baseline gap-3 px-4 py-2">
                    <span className="shrink-0 font-mono text-sm">{skill.id}</span>
                    <span className="min-w-0 truncate text-sm text-muted-foreground">{skill.description}</span>
                  </li>
                ))}
              </ul>
            </TabsContent>
          ) : null}

          <TabsContent value="sub-agents">
            {descriptor.subAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sub-agents.</p>
            ) : (
              <ul className="divide-y rounded-2xl border bg-background/50">
                {descriptor.subAgents.map((link) => {
                  const name = names.get(link.id);
                  const content = (
                    <>
                      <span className="font-medium">{name ?? link.id}</span>
                      {name ? <span className="font-mono text-xs text-muted-foreground">{link.id}</span> : null}
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                    </>
                  );
                  return (
                    <li key={link.id}>
                      <Tooltip>
                        {name ? (
                          <TooltipTrigger
                            render={
                              <Link
                                href={hrefFor(link.id)}
                                className="flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-2"
                              />
                            }
                          >
                            {content}
                          </TooltipTrigger>
                        ) : (
                          <TooltipTrigger render={<div className="flex items-center gap-2 px-4 py-2.5 text-muted-foreground" />}>{content}</TooltipTrigger>
                        )}
                        <TooltipContent>via {link.via}</TooltipContent>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="source">
            {descriptor.native ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span className="font-mono">{descriptor.native.format}</span>
                  <Hint label="Where this agent is stored">Stored as {descriptor.native.format} by {info.label}.</Hint>
                </div>
                <pre className="max-h-[60vh] overflow-auto rounded-2xl border bg-background/50 p-4 font-mono text-xs leading-relaxed">
                  {descriptor.native.text}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This system doesn&apos;t keep a source view for agents.</p>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** Placeholder shown while an agent inspector loads. */
export function AgentInspectorSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border bg-card" aria-busy="true" aria-label="Loading agent">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="h-7 w-48 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="ml-auto size-9 rounded-full" />
      </div>
      <div className="border-b px-5 py-2">
        <Skeleton className="h-8 w-96 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3 p-5">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex flex-col divide-y rounded-2xl border bg-background/50">
            <div className="px-4 py-2.5">
              <Skeleton className="h-4 w-40" />
            </div>
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="flex items-center gap-3 px-4 py-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const ACCESS: Record<ToolAccess | "unknown", { label: string; dot: string }> = {
  granted: { label: "Granted: in the agent's tool list", dot: "bg-chart-1" },
  "on-demand": { label: "On demand: available once the agent loads it", dot: "bg-chart-3" },
  denied: { label: "Denied: not granted to this agent", dot: "bg-muted-foreground/40" },
  unknown: { label: "Unknown until the tool server is inspected", dot: "border border-muted-foreground" },
};

function CapabilitySection({ view }: { view: CapabilityView }) {
  const { capability, tools, note, inspectable } = view;
  const reachable = tools.filter((t) => t.access === "granted" || t.access === "on-demand").length;
  const server = inspectable as McpServerArgs | undefined;

  return (
    <section aria-label={capability.id} className="rounded-2xl border bg-background/50">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="font-mono text-sm font-semibold">{capability.id}</span>
        {capability.description ? <Hint>{capability.description}</Hint> : null}
        {tools.length ? (
          <Tooltip>
            <TooltipTrigger render={<span className="ml-auto text-xs tabular-nums text-muted-foreground" />}>
              {reachable}/{tools.length}
            </TooltipTrigger>
            <TooltipContent>Tools this agent can call, out of the tools the capability offers</TooltipContent>
          </Tooltip>
        ) : null}
      </header>

      {tools.length === 0 ? (
        <div className="flex flex-col gap-3 p-4">
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
          {server ? <ToolInspector readOnly server={server} allowedTools={server.args.allowed_tools} /> : null}
        </div>
      ) : (
        <ul className="divide-y">
          {tools.map(({ tool, access }) => (
            <ToolRow key={tool.name} tool={tool} access={access} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ToolRow({ tool, access }: { tool: CapabilityTool; access: ToolAccess | "unknown" }) {
  const properties = Object.entries(tool.inputSchema?.properties ?? {});
  const required = new Set(tool.inputSchema?.required ?? []);
  const status = ACCESS[access];

  return (
    <li>
      <Collapsible>
        <div className="flex items-center gap-2 px-4 py-2">
          <CollapsibleTrigger render={<button type="button" className="group flex min-w-0 flex-1 items-center gap-2 text-left" />}>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <span className={cn("font-mono text-sm", access === "denied" && "text-muted-foreground")}>{tool.name}</span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{tool.description?.split("\n")[0]}</span>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger render={<span role="img" aria-label={status.label} className="inline-flex shrink-0" />}>
              <span className={cn("size-2 rounded-full", status.dot)} />
            </TooltipTrigger>
            <TooltipContent>{status.label}</TooltipContent>
          </Tooltip>
        </div>
        <CollapsibleContent className="space-y-3 px-4 pb-3 pl-10">
          {tool.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tool.description}</p> : null}
          {properties.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Argument</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map(([name, prop]) => (
                    <tr key={name} className="border-t align-top">
                      <td className="py-1 pr-3 font-mono">
                        {name}
                        {required.has(name) ? <span className="text-destructive">*</span> : null}
                      </td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{typeOf(prop)}</td>
                      <td className="py-1 whitespace-normal text-muted-foreground">{prop.description ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No arguments.</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function typeOf(prop: JsonSchemaProperty): string {
  if (prop.items) return `${typeOf(prop.items)}[]`;
  if (prop.enum && prop.enum.length > 0) return prop.enum.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" | ");
  if (Array.isArray(prop.type)) return prop.type.join(" | ");
  return prop.type ?? "any";
}
