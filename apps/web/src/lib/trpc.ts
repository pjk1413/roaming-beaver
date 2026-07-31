import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@mystery-trips/api";

export const trpc = createTRPCReact<AppRouter>();
