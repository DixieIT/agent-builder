"use client";

import { useState, useTransition } from "react";
import { FolderOpen, Database, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeEnvVarAction, setEnvVarAction } from "@/app/environment/actions";
import { Field, Hint, IconButton } from "@/components/agents/editor/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ENVIRONMENTS, type Environment } from "@/core/environment/environment";
import type { EnvSourceInfo } from "@/core/environment/environment-store.port";

type Var = { key: string; environments: Environment[]; sensitive: boolean; value?: string; preview: string; comment?: string; updatedAt: string };
type Draft = { key: string; value: string; environments: Environment[]; sensitive: boolean; comment: string; editing: boolean };

const ENV_LABEL: Record<Environment, string> = { development: "Development", preview: "Preview", production: "Production" };
const ENV_DOT: Record<Environment, string> = { development: "bg-ocean", preview: "bg-gold", production: "bg-rose" };

export function EnvironmentManager({ source, vars }: { source: EnvSourceInfo; vars: Var[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const visible = vars.filter((v) => v.key.toLowerCase().includes(filter.toLowerCase()));

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const result = await setEnvVarAction({
        key: draft.key.trim(),
        value: draft.value,
        environments: draft.environments,
        sensitive: draft.sensitive,
        comment: draft.comment.trim() || undefined,
      });
      if (result.ok) {
        toast.success(`${draft.key} saved`);
        setDraft(null);
      } else toast.error(result.message);
    });
  }

  function remove(key: string) {
    startTransition(async () => {
      const result = await removeEnvVarAction(key);
      if (result.ok) toast.success(`${key} removed`);
      else toast.error(result.message);
    });
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <h1 className="text-2xl font-semibold">Environment variables</h1>
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className="rounded-full" />}>
            {source.kind === "folder" ? <FolderOpen /> : <Database />}
            {source.kind === "folder" ? "Folder" : "Built-in store"}
          </TooltipTrigger>
          <TooltipContent>
            {source.location}
            {source.writable ? "" : " (read-only)"} · change with ENV_SOURCE / ENV_DIR
          </TooltipContent>
        </Tooltip>
        <Input
          id="env-filter"
          aria-label="Filter variables"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-auto h-8 w-44 rounded-full"
        />
        <IconButton
          label="Add variable"
          variant="default"
          disabled={!source.writable}
          onClick={() => setDraft({ key: "", value: "", environments: [...ENVIRONMENTS], sensitive: true, comment: "", editing: false })}
        >
          <Plus />
        </IconButton>
      </div>

      {vars.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-muted-foreground">
          No variables yet. Add the provider keys and the secrets your agents&apos; tools read (env_keys).
        </div>
      ) : (
        <ul className="divide-y">
          {visible.map((v) => (
            <li key={v.key} className="flex items-center gap-4 px-5 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono text-sm font-medium">{v.key}</span>
                {v.comment ? <Hint>{v.comment}</Hint> : null}
              </div>
              <div className="flex items-center gap-1" aria-label={`Environments: ${v.environments.join(", ")}`}>
                {ENVIRONMENTS.map((env) => (
                  <Tooltip key={env}>
                    <TooltipTrigger render={<span className={`size-2.5 rounded-full ${v.environments.includes(env) ? ENV_DOT[env] : "bg-muted"}`} />} />
                    <TooltipContent>
                      {ENV_LABEL[env]}: {v.environments.includes(env) ? "set" : "not set"}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
              <span className="w-40 truncate text-right font-mono text-xs text-muted-foreground" title={`Updated ${new Date(v.updatedAt).toLocaleString()}`}>
                {v.sensitive ? v.preview : v.value ?? v.preview}
              </span>
              <div className="flex">
                <IconButton
                  label="Edit"
                  disabled={!source.writable}
                  onClick={() => setDraft({ key: v.key, value: v.sensitive ? "" : (v.value ?? ""), environments: v.environments, sensitive: v.sensitive, comment: v.comment ?? "", editing: true })}
                >
                  <Pencil />
                </IconButton>
                <IconButton label="Remove" disabled={!source.writable || pending} onClick={() => remove(v.key)}>
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          {draft ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <DialogHeader>
                <DialogTitle>{draft.editing ? `Edit ${draft.key}` : "Add variable"}</DialogTitle>
              </DialogHeader>
              <Field id="env-key" label="Key">
                <Input id="env-key" className="font-mono" autoFocus={!draft.editing} disabled={draft.editing} value={draft.key} placeholder="ANTHROPIC_API_KEY" onChange={(e) => setDraft({ ...draft, key: e.target.value.toUpperCase() })} />
              </Field>
              <Field id="env-value" label="Value" hint={draft.editing && draft.sensitive ? "Sensitive values are write-only: type the new value." : undefined}>
                <Textarea id="env-value" rows={2} className="font-mono text-sm" autoFocus={draft.editing} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Environments</legend>
                <div className="flex flex-wrap gap-4">
                  {ENVIRONMENTS.map((env) => (
                    <label key={env} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.environments.includes(env)}
                        onCheckedChange={(on) =>
                          setDraft({ ...draft, environments: on ? [...draft.environments, env] : draft.environments.filter((e) => e !== env) })
                        }
                      />
                      <span className={`size-2 rounded-full ${ENV_DOT[env]}`} />
                      {ENV_LABEL[env]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <label htmlFor="env-sensitive">Sensitive</label>
                  <Hint>Hidden after saving; only a short preview is shown.</Hint>
                </span>
                <Switch id="env-sensitive" checked={draft.sensitive} onCheckedChange={(v) => setDraft({ ...draft, sensitive: v })} />
              </div>
              <Field id="env-comment" label="Note">
                <Input id="env-comment" value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
              </Field>
              <DialogFooter>
                <Button type="submit" className="rounded-full" disabled={pending || !draft.key || !draft.environments.length}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
