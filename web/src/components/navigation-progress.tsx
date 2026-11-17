"use client";

import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const FETCH_WRAPPED_FLAG = "__uabFetchLoaderWrapped";
const SKIP_HEADER = "x-skip-loader";
const SKIP_URL_FRAGMENT = "/api/v1/events";
const NAV_SAFETY_TIMEOUT_MS = 15_000;

/** Headers that opt a request out of the top loading bar. */
export function skipLoaderHeaders(): HeadersInit {
  return { [SKIP_HEADER]: "1" };
}

// ---------------------------------------------------------------------------
// In-flight request counter (external store, read via useSyncExternalStore)
// ---------------------------------------------------------------------------

let inFlight = 0;
const storeListeners = new Set<() => void>();

function subscribeInFlight(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function getInFlight(): number {
  return inFlight;
}

function getServerInFlight(): number {
  return 0;
}

function changeInFlight(delta: number): void {
  inFlight = Math.max(0, inFlight + delta);
  storeListeners.forEach((listener) => listener());
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function shouldTrackRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (headers.get(SKIP_HEADER) === "1") return false;

  const raw = requestUrl(input);
  if (raw.includes(SKIP_URL_FRAGMENT)) return false;

  const url = new URL(raw, window.location.href);
  const isApi = url.pathname.includes("/api/");
  const isServerAction = headers.has("Next-Action");
  return isApi || isServerAction;
}

/** Wraps window.fetch exactly once (guarded by a window flag). */
function installFetchWrapper(): void {
  if (typeof window === "undefined") return;
  const flagged = window as unknown as Record<string, boolean | undefined>;
  if (flagged[FETCH_WRAPPED_FLAG]) return;
  flagged[FETCH_WRAPPED_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  const patchedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!shouldTrackRequest(input, init)) return originalFetch(input, init);
    changeInFlight(1);
    return originalFetch(input, init).finally(() => changeInFlight(-1));
  };
  window.fetch = patchedFetch as typeof fetch;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Ends the manual navigation state whenever the route (path or query) changes. */
function RouteWatcher({ onRouteChange }: { onRouteChange: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    onRouteChange();
  }, [routeKey, onRouteChange]);

  return null;
}

export function NavigationProgress() {
  const [navActive, setNavActive] = useState(false);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const fetchCount = useSyncExternalStore(subscribeInFlight, getInFlight, getServerInFlight);
  const active = navActive || fetchCount > 0;

  const endNav = useCallback(() => setNavActive(false), []);

  // One-time global setup: fetch wrapper, click interceptor, custom events.
  useEffect(() => {
    installFetchWrapper();

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const next = new URL(anchor.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      const current = window.location;
      if (next.pathname === current.pathname && next.search === current.search) return;

      setNavActive(true);
    };
    const onStart = () => setNavActive(true);
    const onEnd = () => setNavActive(false);

    document.addEventListener("click", onClick, true);
    window.addEventListener("uab:loading-start", onStart);
    window.addEventListener("uab:loading-end", onEnd);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("uab:loading-start", onStart);
      window.removeEventListener("uab:loading-end", onEnd);
    };
  }, []);

  // Safety net: a navigation that never resolves must not leave the bar stuck.
  useEffect(() => {
    if (!navActive) return;
    const timer = window.setTimeout(() => setNavActive(false), NAV_SAFETY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [navActive]);

  // Show / trickle while active; complete and hide when inactive. State changes run in a frame callback.
  useEffect(() => {
    let interval: number | undefined;
    let hide: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      if (active) {
        setVisible(true);
        if (prefersReducedMotion()) return setWidth(100);
        setWidth((w) => Math.max(w, 8));
        interval = window.setInterval(() => setWidth((w) => Math.min(90, w + (90 - w) * 0.08)), 250);
        return;
      }
      setWidth(100);
      hide = window.setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.clearTimeout(hide);
    };
  }, [active]);

  return (
    <>
      <Suspense fallback={null}>
        <RouteWatcher onRouteChange={endNav} />
      </Suspense>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] transition-opacity duration-300 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{ top: "env(safe-area-inset-top, 0px)" }}
      >
        <div
          className="h-full transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: `${width}%`,
            background: "linear-gradient(90deg, var(--lavender), var(--rose), var(--ocean))",
          }}
        />
      </div>
    </>
  );
}
