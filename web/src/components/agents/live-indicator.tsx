"use client";

import { toast } from "sonner";
import { useAgentEvents } from "@/hooks/use-agent-events";
import { cn } from "@/lib/utils";

export function LiveIndicator() {
  const { connected } = useAgentEvents({
    onEvent: (event) => {
      if (event.type === "agent.deleted") {
        toast(`Agent ${event.id} was deleted`);
      }
    },
  });

  return (
    <span
      role="status"
      title={connected ? "Updates from other tabs and the API appear here automatically." : "Reconnecting…"}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full animate-pulse motion-reduce:animate-none",
          connected ? "bg-ocean" : "bg-muted-foreground",
        )}
      />
      Live
    </span>
  );
}
