import Link from "next/link";
import { connection } from "next/server";
import { LiveIndicator } from "@/components/agents/live-indicator";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { ProjectSidebar, type SidebarProject } from "@/components/projects/project-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { projectRepository } from "@/server/container";

async function listProjects(): Promise<{ projects: SidebarProject[]; problem?: string }> {
  try {
    const projects = await (await projectRepository()).list();
    return { projects: projects.map(({ id, name, description }) => ({ id, name, description })) };
  } catch (error) {
    return { projects: [], problem: error instanceof Error ? error.message : String(error) };
  }
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  await connection(); // the project list is read live
  const { projects, problem } = await listProjects();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/agents" className="flex items-center gap-2.5">
            <Logo className="size-7" />
            <span className="font-heading text-lg font-semibold">Agent Builder</span>
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-3">
            <LiveIndicator />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <ProjectSidebar projects={projects} problem={problem} />
        <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
