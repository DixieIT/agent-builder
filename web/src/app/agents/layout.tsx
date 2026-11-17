import Link from "next/link";
import { LiveIndicator } from "@/components/agents/live-indicator";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/agents" className="flex items-center gap-2.5">
            <Logo className="size-7" />
            <span className="font-heading text-lg font-semibold">Agent Builder</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
            <Link href="/agents" className="rounded-full px-3 py-1.5 font-medium hover:bg-accent">
              Agents
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LiveIndicator />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
