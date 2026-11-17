import { AppShell } from "@/components/app-shell";

export default function EnvironmentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
