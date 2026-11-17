"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/environment", label: "Environment" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-full px-3 py-1.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
