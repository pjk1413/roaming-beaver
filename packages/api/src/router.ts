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
  reshuffleSearchSlots,
  requestFromSearch,
  ensurePackageItinerary,
  MAX_RESHUFFLES,
} from "./search/stream";

function mapPackageRow(row: {
  id: string;
  slot: string;
  rank: number;
  city: string;
  country: string;
  airportCode: string;
  destinationId: string;
  flightJson: unknown;
  hotelJson: unknown;
  rentalCarJson: unknown;
  itineraryJson: unknown;
  subtotalCents: number;
  assemblyFeeCents: number;
  totalCents: number;
  currency: string;
}) {
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
    rentalCar: row.rentalCarJson,
    itinerary: row.itineraryJson,
    subtotalCents: row.subtotalCents,
    assemblyFeeCents: row.assemblyFeeCents,
    totalCents: row.totalCents,
    currency: row.currency,
  });
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

        return {
          searchId: search.id,
          status: search.status,
          slotErrors: (search.slotErrors ?? {}) as Record<string, string>,
          packages: search.packages.map(mapPackageRow),
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

    /**
     * Fetch next-cheapest city per slot (excludes already-shown destinations).
     * Call after initial search completes — up to MAX_RESHUFFLES times.
     */
    reshuffle: publicProcedure
      .input(z.object({ searchId: z.string() }))
      .mutation(async ({ input }) => {
        const result = await reshuffleSearchSlots(input.searchId, async () => {});
        const status = await getSearchStatus(input.searchId);
        return {
          ...status,
          packages: result.packages,
          reshufflesUsed: result.reshufflesUsed,
          maxReshuffles: MAX_RESHUFFLES,
        };
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
