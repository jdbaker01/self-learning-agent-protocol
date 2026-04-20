import { runLearnLoop } from "@/src/sepl/loop";
import type { LearnEvent } from "@/src/sepl/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint. Streams one JSON-encoded LearnEvent per `data:` frame.
 * Client: EventSource (or a simple ReadableStream reader).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: LearnEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      };
      try {
        for await (const evt of runLearnLoop({ sessionId: sid })) send(evt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
