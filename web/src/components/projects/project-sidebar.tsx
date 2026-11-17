"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { IconButton } from "@/components/agents/editor/fields";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SidebarProject = { id: string; name: string; description: string };

/** Projects column of the app shell: a letter rail on small screens, names from md up. */
export function ProjectSidebar({ projects, problem }: { projects: SidebarProject[]; problem?: string }) {
  const pathname = usePathname();
  const active = pathname.split("/")[2]; // "/projects/<id>/..."
  const [creating, setCreating] = useState(false);

  return (
    <aside
      aria-label="Projects"
      className="sticky top-14 flex h-[calc(100svh-3.5rem)] w-14 shrink-0 flex-col gap-1 overflow-y-auto border-r px-2 py-3 md:w-60 md:px-3"
    >
      <div className="flex items-center justify-center gap-2 pb-1 md:justify-between md:px-1">
        <span className="hidden text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">Projects</span>
        <IconButton label="New project" onClick={() => setCreating(true)}>
          <Plus />
        </IconButton>
      </div>

      <nav aria-label="Project list" className="flex flex-col gap-0.5">
        {projects.map((project) => {
          const current = project.id === active;
          return (
            <Tooltip key={project.id}>
              <TooltipTrigger
                render={
                  <Link
                    href={`/projects/${encodeURIComponent(project.id)}`}
                    aria-label={project.name}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:px-1.5",
                      current && "bg-accent text-foreground",
                    )}
                  />
                }
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border bg-background font-heading text-xs uppercase",
                    current && "border-primary/60",
                  )}
                >
                  {project.name.charAt(0)}
                </span>
                <span className="hidden truncate md:block">{project.name}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <span className="block font-medium">{project.name}</span>
                {project.description ? <span className="block">{project.description}</span> : null}
                <span className="block font-mono text-[10px] opacity-70">{project.id}</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {problem ? (
        <Tooltip>
          <TooltipTrigger
            render={<span role="img" aria-label="Projects unavailable" className="flex justify-center py-1 text-destructive md:justify-start md:px-1.5" />}
          >
            <AlertTriangle className="size-4" />
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{problem}</TooltipContent>
        </Tooltip>
      ) : null}

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </aside>
  );
}
