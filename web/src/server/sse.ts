import "server-only";

/**
 * Streams an async iterable as Server-Sent Events. Each item becomes `event: <item.type>` + JSON data.
 * Sends a comment heartbeat every 15 s so proxies keep the connection open. Aborts the source when the client leaves.
 */
export function sseResponse<T extends { type: string }>(
  produce: (signal: AbortSignal) => AsyncIterable<T>,
  request: Request,
): Response {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const send = (chunk: string) => {
        try {
          sink.enqueue(encoder.encode(chunk));
        } catch {
          controller.abort();
        }
      };
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 15_000);
      let seq = 0;
      try {
        for await (const item of produce(controller.signal)) {
          if (controller.signal.aborted) break;
          send(`id: ${++seq}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send(`event: error\ndata: ${JSON.stringify({ type: "error", message })}\n\n`);
      } finally {
        clearInterval(heartbeat);
        try {
          sink.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Turns a subscribe/unsubscribe source into an async iterable that ends when `signal` aborts. */
export async function* fromSubscription<T>(
  subscribe: (push: (item: T) => void) => () => void,
  signal: AbortSignal,
): AsyncIterable<T> {
  const queue: T[] = [];
  let wake: (() => void) | undefined;
  const unsubscribe = subscribe((item) => {
    queue.push(item);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (!signal.aborted) {
      if (queue.length) {
        yield queue.shift() as T;
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = undefined;
    }
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", onAbort);
  }
}
