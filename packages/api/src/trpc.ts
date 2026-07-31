import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { prisma } from "@mystery-trips/db";
import { getSessionFromRequest, type AuthSession, type AuthUser } from "./auth";

export async function createContext(opts: FetchCreateContextFnOptions) {
  const { session, responseCookies } = await getSessionFromRequest(opts.req);
  return {
    prisma,
    session,
    responseCookies,
    req: opts.req,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session as AuthSession,
      user: ctx.session.user as AuthUser,
    },
  });
});
