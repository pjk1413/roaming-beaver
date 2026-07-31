import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  appRouter,
  applySupabaseCookies,
  createContext,
} from "@mystery-trips/api";

const handler = async (req: Request) => {
  let responseCookies: Parameters<typeof applySupabaseCookies>[1] = [];

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: async (opts) => {
      const ctx = await createContext(opts);
      responseCookies = ctx.responseCookies;
      return ctx;
    },
  });

  const headers = new Headers(response.headers);
  applySupabaseCookies(headers, responseCookies);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export { handler as GET, handler as POST };
