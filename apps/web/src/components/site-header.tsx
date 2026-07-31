"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useUser } from "@/lib/auth-client";

const HIDE_BACK = new Set(["/", "/login", "/signup", "/account"]);

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const showBack = !HIDE_BACK.has(pathname) && !pathname.startsWith("/confirmation");

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-[var(--color-line)] bg-[oklch(97%_0.015_75_/_0.85)] px-8 backdrop-blur-[8px]">
      <Link href="/" className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent)] font-display text-[15px] font-bold text-white">
          R
        </div>
        <span className="font-display text-[19px] font-bold tracking-[-0.01em]">
          Roaming Beaver
        </span>
      </Link>

      <div className="flex items-center gap-3">
        {user ? (
          <Link
            href="/account"
            className="hidden text-sm font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] sm:inline"
          >
            {user.name || "Account"}
          </Link>
        ) : (
          <Link
            href="/login"
            className="hidden text-sm font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] sm:inline"
          >
            Log in
          </Link>
        )}
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-[var(--color-line-strong)] px-[18px] py-2 text-sm font-semibold transition hover:border-[oklch(22%_0.02_50_/_0.35)]"
          >
            ← Back
          </button>
        )}
        {user && (
          <button
            type="button"
            className="text-sm font-semibold text-[var(--color-ink-soft)] sm:hidden"
            onClick={() => signOut()}
          >
            Out
          </button>
        )}
      </div>
    </header>
  );
}
