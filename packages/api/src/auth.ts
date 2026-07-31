import { createClient, type User as SupabaseAuthUser } from "@supabase/supabase-js";
import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { prisma } from "@mystery-trips/db";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

export type AuthSession = {
  user: AuthUser;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export function getSupabaseEnv() {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

/** Service-role client for server-only ops (never expose to the browser). */
export function createServiceSupabase() {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Missing env var: SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Build a Supabase server client from an incoming Request's Cookie header.
 * Collects Set-Cookie mutations so the route handler can forward them.
 */
export function createSupabaseFromRequest(req: Request) {
  const { url, anonKey } = getSupabaseEnv();
  const cookieHeader = req.headers.get("cookie") ?? "";
  const responseCookies: { name: string; value: string; options: Record<string, unknown> }[] =
    [];

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader).map((c) => ({
          name: c.name,
          value: c.value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        responseCookies.push(...cookiesToSet);
      },
    },
  });

  return { supabase, responseCookies };
}

export function applySupabaseCookies(
  headers: Headers,
  responseCookies: { name: string; value: string; options: Record<string, unknown> }[],
) {
  for (const { name, value, options } of responseCookies) {
    headers.append(
      "Set-Cookie",
      serializeCookieHeader(name, value, options as Parameters<typeof serializeCookieHeader>[2]),
    );
  }
}

export function toAuthUser(user: SupabaseAuthUser): AuthUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? "",
    name:
      (typeof meta.full_name === "string" && meta.full_name) ||
      (typeof meta.name === "string" && meta.name) ||
      (user.email ? user.email.split("@")[0]! : null),
    image:
      (typeof meta.avatar_url === "string" && meta.avatar_url) ||
      (typeof meta.picture === "string" && meta.picture) ||
      null,
  };
}

/** Upsert public.User profile to match Supabase auth.users. */
export async function syncUserProfile(authUser: AuthUser) {
  if (!authUser.email) return null;

  return prisma.user.upsert({
    where: { id: authUser.id },
    create: {
      id: authUser.id,
      email: authUser.email,
      name: authUser.name,
      image: authUser.image,
      emailVerified: true,
    },
    update: {
      email: authUser.email,
      name: authUser.name ?? undefined,
      image: authUser.image ?? undefined,
    },
  });
}

export async function getSessionFromRequest(
  req: Request,
): Promise<{ session: AuthSession | null; responseCookies: ReturnType<typeof createSupabaseFromRequest>["responseCookies"] }> {
  try {
    const { supabase, responseCookies } = createSupabaseFromRequest(req);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { session: null, responseCookies };
    }
    const authUser = toAuthUser(data.user);
    await syncUserProfile(authUser);
    return { session: { user: authUser }, responseCookies };
  } catch (err) {
    // Missing Supabase env in early boot — treat as logged out
    console.warn("[auth] getSessionFromRequest:", err instanceof Error ? err.message : err);
    return { session: null, responseCookies: [] };
  }
}
