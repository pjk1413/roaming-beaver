import { prisma } from "@mystery-trips/db";
import {
  getSearchStatus,
  requestFromSearch,
  runSearchSlots,
  isMockFlightSupplier,
  isMockHotelSupplier,
  type SearchStreamEvent,
} from "@mystery-trips/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progressive search stream (NDJSON).
 * One long-lived connection: claim + run matcher (emitting events), or follow
 * an in-flight run with slow DB polling. Client should open this once per search.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ searchId: string }> },
) {
  const { searchId } = await ctx.params;
  const search = await prisma.tripSearch.findUnique({
    where: { id: searchId },
    include: { packages: true },
  });

  if (!search) {
    return new Response(JSON.stringify({ error: "Search not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const mock = isMockFlightSupplier() || isMockHotelSupplier();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        send({ type: "started", searchId, mock });

        // Already finished — replay once and close
        if (search.status === "COMPLETE" || search.status === "FAILED") {
          const status = await getSearchStatus(searchId);
          for (const pkg of status?.packages ?? []) {
            send({ type: "package", package: pkg });
          }
          const errors = status?.slotErrors ?? {};
          for (const [slot, message] of Object.entries(errors)) {
            send({
              type: "slot_error",
              slot: slot as "BUDGET_GETAWAY" | "BEACH_ESCAPE" | "EXOTIC_ADVENTURE",
              message,
            });
          }
          send({ type: "done", searchId, mock });
          controller.close();
          return;
        }

        // Another worker owns matching — follow slowly via DB
        if (search.status === "RUNNING") {
          await pollUntilDone(searchId, send, () => closed);
          if (!closed) controller.close();
          return;
        }

        // PENDING — claim and run (emit live as each slot finishes)
        const claimed = await prisma.tripSearch.updateMany({
          where: { id: searchId, status: "PENDING" },
          data: { status: "RUNNING" },
        });

        if (claimed.count === 0) {
          await pollUntilDone(searchId, send, () => closed);
          if (!closed) controller.close();
          return;
        }

        const req = requestFromSearch(search);
        await runSearchSlots(searchId, req, async (event) => {
          if (event.type === "started" || event.type === "done") {
            send({ ...event, mock });
          } else {
            send(event);
          }
        });

        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      } catch (err) {
        console.error("[search/stream]", err);
        if (!closed) {
          send({
            type: "slot_error",
            slot: "BUDGET_GETAWAY",
            message: err instanceof Error ? err.message : "Stream failed",
          });
          send({ type: "done", searchId, mock });
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Slow follower poll — only used when this connection does not own the matcher. */
async function pollUntilDone(
  searchId: string,
  send: (event: SearchStreamEvent) => void,
  isClosed: () => boolean,
) {
  const seen = new Set<string>();
  const seenErrors = new Set<string>();
  const mock = isMockFlightSupplier() || isMockHotelSupplier();

  for (let i = 0; i < 120; i++) {
    if (isClosed()) return;

    const status = await getSearchStatus(searchId);
    if (!status) break;

    for (const pkg of status.packages) {
      if (!seen.has(pkg.id)) {
        seen.add(pkg.id);
        send({ type: "package", package: pkg });
      }
    }
    for (const [slot, message] of Object.entries(status.slotErrors)) {
      if (!seenErrors.has(slot)) {
        seenErrors.add(slot);
        send({
          type: "slot_error",
          slot: slot as "BUDGET_GETAWAY" | "BEACH_ESCAPE" | "EXOTIC_ADVENTURE",
          message,
        });
      }
    }

    if (status.status === "COMPLETE" || status.status === "FAILED") {
      send({ type: "done", searchId, mock });
      return;
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  send({ type: "done", searchId, mock });
}
