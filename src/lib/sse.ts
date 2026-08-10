import { subscribeBoard } from "@/lib/events";

// Every open stream holds a listener and a timer, so the count is capped: a single board (or a
// single misbehaving client) must not be able to pin unbounded server resources.
const MAX_STREAMS_PER_BOARD = 200;
const MAX_STREAMS_TOTAL = 1000;
const openStreams = new Map<string, number>();
let totalStreams = 0;

function acquireSlot(boardId: string) {
  const current = openStreams.get(boardId) ?? 0;
  if (current >= MAX_STREAMS_PER_BOARD || totalStreams >= MAX_STREAMS_TOTAL) return false;
  openStreams.set(boardId, current + 1);
  totalStreams += 1;
  return true;
}

function releaseSlot(boardId: string) {
  const current = openStreams.get(boardId) ?? 0;
  if (current <= 1) openStreams.delete(boardId); else openStreams.set(boardId, current - 1);
  totalStreams = Math.max(0, totalStreams - 1);
}

// Server-Sent Events stream that pushes a contentless "update" whenever the board changes.
export function boardEventStream(boardId: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  // Over capacity: the client keeps working on its 15s heartbeat poll, just without push.
  if (!acquireSlot(boardId)) return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
  let released = false;
  const release = () => { if (!released) { released = true; releaseSlot(boardId); } };

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        try { controller.enqueue(encoder.encode(payload)); } catch { /* stream closed */ }
      };
      send("retry: 3000\ndata: connected\n\n");
      unsubscribe = subscribeBoard(boardId, () => send("data: update\n\n"));
      keepalive = setInterval(() => send(": ping\n\n"), 25000);
      signal.addEventListener("abort", () => {
        if (keepalive) clearInterval(keepalive);
        unsubscribe();
        release();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      unsubscribe();
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
