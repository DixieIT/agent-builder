"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useImmer } from "use-immer";
import { AlertCircle, ChevronRight, Lock, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteAgentAction, saveAgentAction } from "@/app/agents/actions";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { validateAgentSpec, type LeleAgentSpec } from "@/core/agents/agent-spec";
import type { Capability, CapabilityTool } from "@/core/capabilities/capability";
import type { RuntimeSkill } from "@/core/capabilities/capability-catalog.port";
import {
  capabilityAccess,
  grantCapability,
  normalizeGrants,
  LELE_AGENT_FLOOR,
  revokeCapability,
  setToolAccess,
  toolAccess,
  type Grants,
  type ToolAccess,
} from "@/core/capabilities/lele-access";
import { cn } from "@/lib/utils";
import { Field, Hint, IconButton, TextField } from "./fields";

type Props = {
  id: string;
  initialSpec: LeleAgentSpec;
  updatedAt: string;
  capabilities: Capability[];
  floor: string[];
  skills: RuntimeSkill[];
  limitations: string[];
  definition: string;
  catalogError?: string;
};

export function LeleAgentEditor({ id, initialSpec, updatedAt, capabilities, floor: liveFloor, skills, limitations, definition, catalogError }: Props) {
  const floor = liveFloor.length ? liveFloor : LELE_AGENT_FLOOR;
  const [spec, update] = useImmer<LeleAgentSpec>(initialSpec);
  const [saved, setSaved] = useState(() => JSON.stringify(initialSpec));
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = JSON.stringify(spec) !== saved;
  const { issues } = useMemo(() => validateAgentSpec(spec), [spec]);
  const errors = issues.filter((i) => i.severity === "error");
  const fieldError = (path: string) => errors.find((i) => i.path === path)?.message;
  const grants = spec.capabilities as Grants;
  // Every edit is stored in canonical form: whole capabilities first, finer grants only for exceptions.
  // Skill names stay as written (granting one also force-loads the skill in lele).
  const skillNames = useMemo(() => new Set(skills.map((s) => s.name)), [skills]);
  const setGrants = (next: Grants) =>
    update((d) => void (d.capabilities = capabilities.length ? normalizeGrants(next, capabilities, floor, skillNames) : next));

  const included = capabilities.filter((c) => capabilityAccess(c, grants, floor) !== "none");
  const available = capabilities.filter((c) => capabilityAccess(c, grants, floor) === "none");
  const known = new Set([...capabilities.flatMap((c) => [c.id, ...c.tools.flatMap((t) => [t.name, t.group])]), ...skills.map((s) => s.name), ...floor]);
  const unknownGrants = Object.keys(grants).filter((name) => !known.has(name));
  const loadedSkills = skills.filter((s) => grants[s.name] === "active").length;

  const save = useCallback(() => {
    startSaving(async () => {
      const result = await saveAgentAction(id, spec);
      if (result.ok) {
        setSaved(JSON.stringify(spec));
        setSavedAt(result.updatedAt);
        toast.success("Agent saved");
      } else toast.error(result.message, { description: result.issues?.map((i) => i.message).join(" · ") });
    });
  }, [id, spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tooltip>
            <TooltipTrigger render={<h1 className="truncate text-2xl font-semibold" />}>{spec.name}</TooltipTrigger>
            <TooltipContent>
              lele · {id} · {dirty ? "Unsaved changes" : `Saved ${new Date(savedAt).toLocaleString()}`}
            </TooltipContent>
          </Tooltip>
          <Badge variant="outline" className="rounded-full font-mono text-[11px]">
            lele
          </Badge>
          {dirty ? <span aria-label="Unsaved changes" className="size-2 shrink-0 rounded-full bg-peach" /> : null}
        </div>
        {errors.length ? (
          <Badge variant="destructive" className="rounded-full">
            <AlertCircle /> {errors.length}
          </Badge>
        ) : null}
        <IconButton label="Delete" disabled={deleting} onClick={() => setConfirmDelete(true)}>
          <Trash2 />
        </IconButton>
        <IconButton label={saving ? "Saving…" : "Save (Ctrl+S)"} variant="default" onClick={save} disabled={!dirty || saving}>
          <Save />
        </IconButton>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {id}?</AlertDialogTitle>
              <AlertDialogDescription>Removes its AGENTS.md from the lele project. This can’t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep agent</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  startDeleting(async () => {
                    const result = await deleteAgentAction(id);
                    if (result && !result.ok) toast.error(result.message);
                  })
                }
              >
                Delete agent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Tabs defaultValue="overview" className="gap-0">
        <div className="border-b px-5 py-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="capabilities">
              Capabilities <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">{included.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="skills">
              Skills <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">{loadedSkills}</Badge>
            </TabsTrigger>
            <TabsTrigger value="file">AGENTS.md</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-5">
          <TabsContent value="overview" className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="lele-name" label="Name" mono value={spec.name} error={fieldError("name")} hint="The folder name in .lele/agents." onChange={(v) => update((d) => void (d.name = v ?? ""))} />
              <TextField
                id="lele-model"
                label="Model"
                mono
                value={spec.model}
                error={fieldError("model")}
                placeholder="lele default"
                hint="provider:model, or an OpenRouter slug. Empty uses lele's default."
                onChange={(v) => update((d) => void (d.model = v))}
              />
            </div>
            <TextField id="lele-description" label="Description" value={spec.description || undefined} hint="Shown in lele's agent roster. Empty uses the first line of the instructions." onChange={(v) => update((d) => void (d.description = v ?? ""))} />
            <Field id="lele-instructions" label="Instructions" error={fieldError("instructions")} hint="The AGENTS.md body; lele uses it as the agent's identity in the system prompt.">
              <Textarea id="lele-instructions" rows={12} className="font-mono text-sm" value={spec.instructions} onChange={(e) => update((d) => void (d.instructions = e.target.value))} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow id="lele-hidden" label="Hidden" hint="Left out of the roster and the TUI picker." checked={spec.hidden ?? false} onChange={(v) => update((d) => void (d.hidden = v || undefined))} />
              <ToggleRow id="lele-simple" label="Simple" hint="Strips the coding-agent scaffolding from the prompt." checked={spec.simple ?? false} onChange={(v) => update((d) => void (d.simple = v || undefined))} />
            </div>
          </TabsContent>

          <TabsContent value="capabilities" className="flex flex-col gap-3">
            {catalogError ? (
              <p className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                Couldn’t read lele’s capabilities: {catalogError}
              </p>
            ) : null}
            {included.map((capability) => (
              <CapabilityCard
                key={capability.id}
                capability={capability}
                grants={grants}
                floor={floor}
                onRevoke={() => setGrants(revokeCapability(grants, capability, floor))}
                onToolChange={(tool, on) => setGrants(setToolAccess(grants, capability, tool, on, floor))}
              />
            ))}
            {unknownGrants.map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-2xl border border-dashed px-4 py-2.5 text-sm">
                <span className="font-mono">{name}</span>
                <span className="text-muted-foreground">{grants[name]}</span>
                <Hint>Not provided by this lele installation; lele ignores it. Kept as written.</Hint>
                <IconButton
                  label={`Remove ${name}`}
                  className="ml-auto"
                  onClick={() =>
                    update((d) => {
                      delete d.capabilities[name];
                    })
                  }
                >
                  <X />
                </IconButton>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger render={<button type="button" disabled={!available.length} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50" />}>
                  <Plus className="size-4" /> Add capability
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-96">
                  {available.map((capability) => (
                    <DropdownMenuItem key={capability.id} className="flex flex-col items-start gap-0.5" onClick={() => setGrants(grantCapability(grants, capability))}>
                      <span className="font-mono text-sm">{capability.id}</span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {capability.description || capability.tools.map((t) => t.name).join(", ")}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {limitations.length ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  How lele grants <Hint>{limitations.join(" ")}</Hint>
                </span>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="skills" className="flex flex-col gap-2">
            <ul className="divide-y rounded-2xl border bg-background/50">
              {skills.map((skill) => (
                <li key={`${skill.source}-${skill.name}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{skill.name}</span>
                      <Hint>
                        {skill.source}: {skill.path}
                      </Hint>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                  </div>
                  {skill.grantable ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Switch
                          aria-label={`Always load ${skill.name}`}
                          checked={grants[skill.name] === "active"}
                          onCheckedChange={(on) =>
                            update((d) => {
                              if (on) d.capabilities[skill.name] = "active";
                              else delete d.capabilities[skill.name];
                            })
                          }
                        />
                      </TooltipTrigger>
                      <TooltipContent>Always load (otherwise loaded on demand)</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex text-muted-foreground" aria-label="On demand only" />}>
                        <Lock className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>Loaded on demand; only lele’s own package skills can be always-loaded.</TooltipContent>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="file">
            <pre className="max-h-[60vh] overflow-auto rounded-2xl border bg-background/50 p-4 font-mono text-xs leading-relaxed">{dirty ? "Save to refresh the file preview.\n\n" + definition : definition}</pre>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

const ACCESS_LABEL: Record<ToolAccess, string> = { granted: "in the agent's tool list", "on-demand": "on demand: joins after load_skill", denied: "not granted" };

function CapabilityCard({
  capability,
  grants,
  floor,
  onRevoke,
  onToolChange,
}: {
  capability: Capability;
  grants: Grants;
  floor: readonly string[];
  onRevoke: () => void;
  onToolChange: (tool: CapabilityTool, on: boolean) => void;
}) {
  const reachable = capability.tools.filter((t) => toolAccess(capability, t, grants, floor) !== "denied").length;
  return (
    <section aria-label={capability.id} className="rounded-2xl border bg-background/50">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="font-mono text-sm font-semibold">{capability.id}</span>
        {capability.description ? <Hint>{capability.description}</Hint> : null}
        <span className="text-xs text-muted-foreground" title="Tools the agent can use">
          {reachable}/{capability.tools.length}
        </span>
        <IconButton label="Remove capability" className="ml-auto" onClick={onRevoke}>
          <X />
        </IconButton>
      </header>
      <ul className="divide-y">
        {capability.tools.map((tool) => (
          <ToolRow key={tool.name} tool={tool} access={toolAccess(capability, tool, grants, floor)} onChange={(on) => onToolChange(tool, on)} />
        ))}
      </ul>
    </section>
  );
}

function ToolRow({ tool, access, onChange }: { tool: CapabilityTool; access: ToolAccess; onChange: (on: boolean) => void }) {
  const props = Object.entries(tool.inputSchema?.properties ?? {});
  const required = new Set(tool.inputSchema?.required ?? []);
  return (
    <li>
      <Collapsible>
        <div className="flex items-center gap-2 px-4 py-2">
          <CollapsibleTrigger render={<button type="button" className="group flex min-w-0 flex-1 items-center gap-2 text-left" />}>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            <span className={cn("font-mono text-sm", access === "denied" && "text-muted-foreground")}>{tool.name}</span>
            {tool.deferred ? (
              <Badge variant="outline" className="rounded-full text-[10px]">
                on demand
              </Badge>
            ) : null}
            <span className="min-w-0 truncate text-xs text-muted-foreground">{tool.description?.split("\n")[0]}</span>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Switch aria-label={`${tool.name}: ${ACCESS_LABEL[access]}`} checked={access !== "denied"} onCheckedChange={onChange} />
            </TooltipTrigger>
            <TooltipContent>
              {ACCESS_LABEL[access]} · grant group {tool.group}
            </TooltipContent>
          </Tooltip>
        </div>
        <CollapsibleContent className="px-4 pb-3 pl-10">
          {tool.description ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tool.description}</p> : null}
          {props.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Argument</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {props.map(([name, schema]) => (
                    <tr key={name} className="border-t align-top">
                      <td className="py-1 pr-3 font-mono">
                        {name}
                        {required.has(name) ? <span className="text-destructive">*</span> : null}
                      </td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{typeOf(schema)}</td>
                      <td className="py-1 text-muted-foreground">{(schema as { description?: string })?.description ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">No arguments.</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function typeOf(schema: unknown): string {
  const s = schema as { type?: string | string[]; enum?: unknown[]; items?: { type?: string } } | undefined;
  if (!s) return "";
  if (s.enum) return s.enum.map(String).join(" | ");
  if (s.type === "array") return `${s.items?.type ?? "any"}[]`;
  return Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "");
}

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/50 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <label htmlFor={id}>{label}</label>
        <Hint>{hint}</Hint>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
