"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentEvent } from "@/core/agents/agent-events.port";

const EVENT_NAMES = ["agent.created", "agent.updated", "agent.deleted"] as const;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000] as const;
const REFRESH_DEBOUNCE_MS = 300;

export type UseAgentEventsOptions = {
  onEvent?: (event: AgentEvent) => void;
  /** Re-run server components via router.refresh() after each event (debounced). Default: true. */
  refresh?: boolean;
};

export function useAgentEvents(options: UseAgentEventsOptions = {}): { connected: boolean } {
  const { onEvent, refresh = true } = options;
  const router = useRouter();
  const [connected, setConnected] = useState(false);

  // Keep latest options/router in refs so the connection is not recreated on every render.
  const onEventRef = useRef(onEvent);
  const refreshRef = useRef(refresh);
  const routerRef = useRef(router);
  useEffect(() => {
    onEventRef.current = onEvent;
    refreshRef.current = refresh;
    routerRef.current = router;
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retries = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (!refreshRef.current) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => routerRef.current.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const handleMessage = (message: MessageEvent) => {
      let event: AgentEvent;
      try {
        event = JSON.parse(String(message.data)) as AgentEvent;
      } catch {
        return;
      }
      onEventRef.current?.(event);
      scheduleRefresh();
    };

    const connect = () => {
      if (closed) return;
      const next = new EventSource("/api/v1/events");
      source = next;

      next.onopen = () => {
        retries = 0;
        setConnected(true);
      };
      for (const name of EVENT_NAMES) {
        next.addEventListener(name, handleMessage);
      }
      next.onerror = () => {
        setConnected(false);
        next.close();
        if (source === next) source = null;
        if (closed) return;
        const delay = RECONNECT_DELAYS_MS[Math.min(retries, RECONNECT_DELAYS_MS.length - 1)];
        retries += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(refreshTimer);
      source?.close();
      source = null;
      setConnected(false);
    };
  }, []);

  return { connected };
}
