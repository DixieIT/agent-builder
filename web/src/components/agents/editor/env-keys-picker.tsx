"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ENVIRONMENTS, type Environment } from "@/core/environment/environment";
import { cn } from "@/lib/utils";
import { Hint } from "./fields";

/** Variables defined in the environment store: key -> environments where it has a value. */
export type EnvIndex = Record<string, Environment[]>;
export const EnvIndexContext = createContext<EnvIndex>({});

/** Pick the variables a tool server needs from the ones defined under Environment. */
export function EnvKeysPicker({ id, value, onChange }: { id: string; value: string[] | undefined; onChange: (keys: string[] | undefined) => void }) {
  const index = useContext(EnvIndexContext);
  const selected = value ?? [];
  const available = Object.keys(index).filter((k) => !selected.includes(k)).sort();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium" id={`${id}-label`}>
        Secrets
        <Hint>Environment variables passed to this server at run time (env_keys). Values come from the Environment page for the environment you run in.</Hint>
      </span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl border bg-background/50 px-2 py-1.5">
        {selected.map((key) => {
          const set = index[key] ?? [];
          const missing = ENVIRONMENTS.filter((env) => !set.includes(env));
          return (
            <Tooltip key={key}>
              <TooltipTrigger
                render={
                  <Badge
                    variant={set.length === 0 ? "destructive" : "secondary"}
                    className={cn("gap-1 rounded-full pr-1 font-mono", missing.length > 0 && set.length > 0 && "ring-1 ring-gold")}
                  />
                }
              >
                {key}
                <button type="button" aria-label={`Remove ${key}`} className="rounded-full p-0.5 hover:bg-foreground/10" onClick={() => onChange(selected.length > 1 ? selected.filter((k) => k !== key) : undefined)}>
                  <X className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{set.length === 0 ? "Not defined in any environment" : missing.length ? `Missing in ${missing.join(", ")}` : "Set in every environment"}</TooltipContent>
            </Tooltip>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="rounded-full" aria-label="Add a secret" />}>
            <Plus />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-auto">
            {available.length === 0 ? (
              <DropdownMenuItem disabled>No other variables defined</DropdownMenuItem>
            ) : (
              available.map((key) => (
                <DropdownMenuItem key={key} className="font-mono text-xs" onClick={() => onChange([...selected, key])}>
                  {key}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/environment" />}>Manage variables…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
