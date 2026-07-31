import { prisma } from "@mystery-trips/db";
import {
  getSearchStatus,
  requestFromSearch,
  runSearchSlots,
  type SearchStreamEvent,
} from "@mystery-trips/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Progressive search stream (NDJSON).
 * Client should open this after `search.start` and render skeleton cards,
 * replacing each as `{ type: "package" }` events arrive.
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SearchStreamEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "started", searchId });

        // Already finished — replay stored packages
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
          send({ type: "done", searchId });
          controller.close();
          return;
        }

        // Already running with some packages — emit what we have, then poll DB
        // until complete (another request may own the runner).
        if (search.status === "RUNNING") {
          for (const row of search.packages) {
            const status = await getSearchStatus(searchId);
            const pkg = status?.packages.find((p) => p.id === row.id);
            if (pkg) send({ type: "package", package: pkg });
          }
          await pollUntilDone(searchId, send);
          controller.close();
          return;
        }

        // PENDING — we own the run
        const req = requestFromSearch(search);
        await runSearchSlots(searchId, req, async (event) => {
          send(event);
        });
        controller.close();
      } catch (err) {
        console.error("[search/stream]", err);
        if (!closed) {
          send({
            type: "slot_error",
            slot: "BUDGET_GETAWAY",
            message: err instanceof Error ? err.message : "Stream failed",
          });
          send({ type: "done", searchId });
          controller.close();
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

async function pollUntilDone(
  searchId: string,
  send: (event: SearchStreamEvent) => void,
) {
  const seen = new Set<string>();
  const seenErrors = new Set<string>();
  for (let i = 0; i < 120; i++) {
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
      send({ type: "done", searchId });
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  send({ type: "done", searchId });
}
