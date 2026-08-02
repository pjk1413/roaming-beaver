import { z } from "zod";
import {
  CheckoutRequestSchema,
  DestinationPackageSchema,
  TripSearchRequestSchema,
} from "@mystery-trips/types";
import { prisma } from "@mystery-trips/db";
import { publicProcedure, protectedProcedure, router } from "./trpc";
import {
  createOrderFromCheckout,
  createPaymentIntent,
  fulfillOrderAfterPayment,
  syncBuyerFromStripePaymentIntent,
  toOrderDto,
} from "./checkout/service";
import {
  createSearchRecord,
  getSearchStatus,
  runSearchSlots,
  requestFromSearch,
  ensurePackageItinerary,
} from "./search/stream";

function mapPackageRow(
  row: {
    id: string;
    slot: string;
    rank: number;
    city: string;
    country: string;
    airportCode: string;
    destinationId: string;
    flightJson: unknown;
    hotelJson: unknown;
    itineraryJson: unknown;
    subtotalCents: number;
    assemblyFeeCents: number;
    totalCents: number;
    currency: string;
  },
  images: Array<{
    url: string;
    thumbUrl: string | null;
    attribution: string | null;
    source: string;
    sourcePageUrl: string | null;
    kind: string;
    caption: string | null;
    sortOrder: number;
  }> = [],
) {
  return DestinationPackageSchema.parse({
    id: row.id,
    slot: row.slot,
    rank: row.rank,
    city: row.city,
    country: row.country,
    airportCode: row.airportCode,
    destinationId: row.destinationId,
    flight: row.flightJson,
    hotel: row.hotelJson,
    itinerary: row.itineraryJson,
    subtotalCents: row.subtotalCents,
    assemblyFeeCents: row.assemblyFeeCents,
    totalCents: row.totalCents,
    currency: row.currency,
    images,
  });
}

async function imagesByDestinationIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    return new Map<string, ReturnType<typeof mapImage>[]>();
  }

  const rows = await prisma.destinationImage.findMany({
    where: { destinationId: { in: unique } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const map = new Map<string, ReturnType<typeof mapImage>[]>();
  for (const row of rows) {
    const list = map.get(row.destinationId) ?? [];
    list.push(mapImage(row));
    map.set(row.destinationId, list);
  }
  return map;
}

function mapImage(row: {
  url: string;
  thumbUrl: string | null;
  attribution: string | null;
  source: string;
  sourcePageUrl: string | null;
  kind: string;
  caption: string | null;
  sortOrder: number;
}) {
  return {
    url: row.url,
    thumbUrl: row.thumbUrl,
    attribution: row.attribution,
    source: row.source,
    sourcePageUrl: row.sourcePageUrl,
    kind: row.kind,
    caption: row.caption,
    sortOrder: row.sortOrder,
  };
}

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),

  search: router({
    /** Instant: create search row only — client then opens the stream. */
    start: publicProcedure
      .input(TripSearchRequestSchema)
      .mutation(async ({ ctx, input }) => {
        const search = await createSearchRecord(input, ctx.session?.user?.id);
        return { searchId: search.id };
      }),

    /** Polling fallback when streaming is buffered by a proxy/CDN. */
    status: publicProcedure
      .input(z.object({ searchId: z.string() }))
      .query(async ({ input }) => getSearchStatus(input.searchId)),

    /** Blocking full search (kept for scripts / simple clients). */
    create: publicProcedure
      .input(TripSearchRequestSchema)
      .mutation(async ({ ctx, input }) => {
        const search = await createSearchRecord(input, ctx.session?.user?.id);
        await runSearchSlots(search.id, input, async () => {});
        const status = await getSearchStatus(search.id);
        if (!status || status.packages.length === 0) {
          throw new Error("No packages found for these dates. Try different dates.");
        }
        return {
          searchId: search.id,
          packages: status.packages,
        };
      }),

    get: publicProcedure
      .input(z.object({ searchId: z.string() }))
      .query(async ({ input }) => {
        const search = await prisma.tripSearch.findUnique({
          where: { id: input.searchId },
          include: {
            packages: { orderBy: [{ slot: "asc" }, { rank: "asc" }] },
          },
        });
        if (!search) return null;

        const imageMap = await imagesByDestinationIds(
          search.packages.map((p) => p.destinationId),
        );

        return {
          searchId: search.id,
          status: search.status,
          slotErrors: (search.slotErrors ?? {}) as Record<string, string>,
          packages: search.packages.map((p) =>
            mapPackageRow(p, imageMap.get(p.destinationId) ?? []),
          ),
        };
      }),

    /** Kick off slot matching without streaming (idempotent if already running). */
    run: publicProcedure
      .input(z.object({ searchId: z.string() }))
      .mutation(async ({ input }) => {
        const search = await prisma.tripSearch.findUnique({
          where: { id: input.searchId },
        });
        if (!search) throw new Error("Search not found");
        if (search.status === "COMPLETE" || search.status === "FAILED") {
          return getSearchStatus(search.id);
        }
        if (search.status === "PENDING") {
          const claimed = await prisma.tripSearch.updateMany({
            where: { id: search.id, status: "PENDING" },
            data: { status: "RUNNING" },
          });
          if (claimed.count > 0) {
            const req = requestFromSearch(search);
            void runSearchSlots(search.id, req, async () => {}).catch((err) => {
              console.error("[search.run] matcher failed", err);
            });
          }
        }
        return getSearchStatus(search.id);
      }),

    /** Generate itinerary on demand for trip detail (kept off the hot search path). */
    ensureItinerary: publicProcedure
      .input(z.object({ packageId: z.string() }))
      .mutation(async ({ input }) => ensurePackageItinerary(input.packageId)),
  }),

  checkout: router({
    start: publicProcedure
      .input(CheckoutRequestSchema)
      .mutation(async ({ ctx, input }) => {
        const order = await createOrderFromCheckout(
          input,
          ctx.session?.user?.id,
        );
        const payment = await createPaymentIntent(order.id);
        return {
          orderId: order.id,
          clientSecret: payment.clientSecret,
          paymentIntentId: payment.paymentIntentId,
          mock: payment.mock,
          totalCents: order.totalCents,
          currency: order.currency,
        };
      }),

    confirm: publicProcedure
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ input }) => {
        const order = await prisma.order.findUnique({
          where: { id: input.orderId },
        });
        if (!order) throw new Error("Order not found");

        await syncBuyerFromStripePaymentIntent(order.id);

        if (order.status === "PENDING_PAYMENT") {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID" },
          });
        }

        const fulfilled = await fulfillOrderAfterPayment(order.id);
        return toOrderDto(fulfilled);
      }),

    get: publicProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ input }) => {
        const order = await prisma.order.findUnique({
          where: { id: input.orderId },
        });
        if (!order) return null;
        return toOrderDto(order);
      }),
  }),

  account: router({
    orders: protectedProcedure.query(async ({ ctx }) => {
      const orders = await prisma.order.findMany({
        where: {
          OR: [{ userId: ctx.user.id }, { email: ctx.user.email }],
        },
        orderBy: { createdAt: "desc" },
      });
      return orders.map(toOrderDto);
    }),
  }),
});

export type AppRouter = typeof appRouter;
