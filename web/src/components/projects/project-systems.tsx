"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateProjectAction } from "@/app/projects/actions";
import { Hint, IconButton } from "@/components/agents/editor/fields";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SystemSource } from "@/core/projects/project";

const KINDS = ["lele", "fs", "sqlite", "litellm"] as const;
type Kind = (typeof KINDS)[number];

/** One attached system: the saved source, plus what the container resolved it to. */
export type SystemRow = { source: SystemSource; label: string; agents?: number; problem?: string };

export function ProjectSystems({ project, rows }: { project: { id: string; name: string; description: string }; rows: SystemRow[] }) {
  const [kind, setKind] = useState<Kind>("lele");
  const [location, setLocation] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function save(systems: SystemSource[], done: string, onSaved?: () => void) {
    startTransition(async () => {
      const result = await updateProjectAction(project.id, { name: project.name, description: project.description, systems });
      if (result.ok) {
        toast.success(done);
        onSaved?.();
      } else {
        toast.error(result.message);
      }
    });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const source: SystemSource = { kind, location: location.trim(), ...(label.trim() ? { label: label.trim() } : {}) };
    save([...rows.map((row) => row.source), source], `Added ${kind}`, () => {
      setLocation("");
      setLabel("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attached systems.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-background/50">
          {rows.map((row, index) => (
            <li key={`${row.source.kind}-${row.source.location}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-40 shrink-0 truncate font-medium">{row.label}</span>
              <Badge variant="outline" className="shrink-0 rounded-full font-mono text-[11px]">
                {row.source.kind}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{row.source.location}</span>
              {row.agents !== undefined ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                    <Badge variant="outline" className="rounded-full tabular-nums">
                      {row.agents}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{row.agents === 1 ? "1 agent" : `${row.agents} agents`}</TooltipContent>
                </Tooltip>
              ) : null}
              {row.problem ? (
                <Tooltip>
                  <TooltipTrigger render={<span role="img" aria-label="Unavailable" className="inline-flex shrink-0 text-destructive" />}>
                    <AlertTriangle className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-72">{row.problem}</TooltipContent>
                </Tooltip>
              ) : null}
              <IconButton
                label="Remove system"
                disabled={pending}
                onClick={() => save(rows.filter((_, i) => i !== index).map((other) => other.source), "Removed system")}
              >
                <Trash2 />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Hint label="Attached systems">A folder, a database file or a URL, depending on the kind.</Hint>
        <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
          <SelectTrigger size="sm" aria-label="System kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Location"
          required
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
          className="min-w-0 flex-1 basis-64 font-mono text-sm"
        />
        <Input aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="w-36" />
        <IconButton type="submit" label="Add system" disabled={pending || !location.trim()}>
          <Plus />
        </IconButton>
      </form>
    </div>
  );
}
