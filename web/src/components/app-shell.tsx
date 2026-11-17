import Link from "next/link";
import { LiveIndicator } from "@/components/agents/live-indicator";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
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
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
