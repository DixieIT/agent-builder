"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useImmer } from "use-immer";
import { AlertCircle, Lock, Save, Trash2 } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { validateAgentSpec, type LeleAgentSpec, type LeleGrant } from "@/core/agents/agent-spec";
import type { RuntimeSkill, RuntimeToolGroup } from "@/core/runtime/runtime-catalog.port";
import { cn } from "@/lib/utils";
import { Field, Hint, IconButton, TextField } from "./fields";

type Props = {
  id: string;
  initialSpec: LeleAgentSpec;
  updatedAt: string;
  toolGroups: RuntimeToolGroup[];
  skills: RuntimeSkill[];
  limitations: string[];
  definition: string;
};

type GrantChoice = "default" | LeleGrant;

export function LeleAgentEditor({ id, initialSpec, updatedAt, toolGroups, skills, limitations, definition }: Props) {
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

  const setGrant = (name: string, choice: GrantChoice) =>
    update((d) => {
      if (choice === "default") delete d.tools[name];
      else d.tools[name] = choice;
    });

  const activeCount = Object.values(spec.tools).filter((g) => g === "active").length;
  const grantedSkills = skills.filter((s) => spec.tools[s.name] === "active").length;

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
            <TabsTrigger value="tools">
              Tools <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">{activeCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="skills">
              Skills <Badge variant="secondary" className="ml-1 rounded-full px-1.5 text-[10px]">{grantedSkills}</Badge>
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

          <TabsContent value="tools" className="flex flex-col gap-2">
            <SectionNote notes={limitations.filter((l) => /tool|deferred/i.test(l))} />
            <ul className="divide-y rounded-2xl border bg-background/50">
              {toolGroups.map((group) => (
                <GrantRow
                  key={group.name}
                  name={group.name}
                  description={group.description}
                  meta={group.tools.map((t) => t.name).join(", ")}
                  source={group.source}
                  defaultState={group.defaultState}
                  value={spec.tools[group.name]}
                  onChange={(choice) => setGrant(group.name, choice)}
                />
              ))}
              {Object.keys(spec.tools)
                .filter((name) => !toolGroups.some((g) => g.name === name) && !skills.some((s) => s.name === name))
                .map((name) => (
                  <GrantRow key={name} name={name} description="Not found in this lele installation." source="unknown" defaultState="disabled" value={spec.tools[name]} onChange={(choice) => setGrant(name, choice)} />
                ))}
            </ul>
          </TabsContent>

          <TabsContent value="skills" className="flex flex-col gap-2">
            <SectionNote notes={limitations.filter((l) => /skill/i.test(l))} />
            <ul className="divide-y rounded-2xl border bg-background/50">
              {skills.map((skill) => (
                <li key={`${skill.source}-${skill.name}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{skill.name}</span>
                      <Hint>
                        {skill.description} ({skill.source}: {skill.path})
                      </Hint>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                  </div>
                  {skill.grantable ? (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Switch
                          aria-label={`Always load ${skill.name}`}
                          checked={spec.tools[skill.name] === "active"}
                          onCheckedChange={(on) => setGrant(skill.name, on ? "active" : "default")}
                        />
                      </TooltipTrigger>
                      <TooltipContent>Always load (otherwise loaded on demand)</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex text-muted-foreground" aria-label="On demand only" />}>
                        <Lock className="size-4" />
                      </TooltipTrigger>
                      <TooltipContent>lele loads this skill on demand; only package skills can be always-loaded.</TooltipContent>
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

const STATE_LABEL: Record<RuntimeToolGroup["defaultState"], string> = {
  floor: "always on",
  active: "on by default",
  available: "on demand",
  disabled: "off by default",
};

function GrantRow(props: {
  name: string;
  description?: string;
  meta?: string;
  source: string;
  defaultState: RuntimeToolGroup["defaultState"];
  value: LeleGrant | undefined;
  onChange: (choice: GrantChoice) => void;
}) {
  const choices: { value: GrantChoice; label: string }[] = [
    { value: "default", label: "Default" },
    { value: "active", label: "On" },
    { value: "disabled", label: "Off" },
  ];
  const current: GrantChoice = props.value ?? "default";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{props.name}</span>
          <Hint>
            {[props.description, props.meta && `Tools: ${props.meta}`, `${props.source}, ${STATE_LABEL[props.defaultState]}`].filter(Boolean).join(" · ")}
          </Hint>
        </div>
      </div>
      <div role="radiogroup" aria-label={`Grant for ${props.name}`} className="inline-flex rounded-full border bg-muted p-0.5">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={current === choice.value}
            onClick={() => props.onChange(choice.value)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors",
              current === choice.value && "bg-card text-foreground shadow-sm",
              current === choice.value && choice.value === "active" && "bg-primary text-primary-foreground",
              current === choice.value && choice.value === "disabled" && "bg-destructive/15 text-destructive",
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </li>
  );
}

function SectionNote({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <p className="flex items-center gap-1.5 self-end text-xs text-muted-foreground">
      lele limits <Hint>{notes.join(" ")}</Hint>
    </p>
  );
}
