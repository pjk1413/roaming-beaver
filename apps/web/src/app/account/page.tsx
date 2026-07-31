"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useUser } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";
import { SLOT_META, formatMoney } from "@/lib/format";

export default function AccountPage() {
  const router = useRouter();
  const { user, isPending } = useUser();
  const { data: orders, isLoading } = trpc.account.orders.useQuery(undefined, {
    enabled: !!user,
  });

  if (isPending) {
    return <div className="px-8 py-20">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20 animate-fade-up">
        <div className="mb-2.5 font-mono text-[13px] font-bold text-[var(--color-accent)]">
          ACCOUNT
        </div>
        <h1 className="font-display text-4xl font-bold">Your trips</h1>
        <p className="mt-3 text-[var(--color-ink-soft)]">
          Log in to see your trip history.
        </p>
        <Link href="/login" className="btn-primary mt-8 inline-block">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-20 animate-fade-up">
      <div className="mb-10 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2.5 font-mono text-[13px] font-bold text-[var(--color-accent)]">
            ACCOUNT
          </div>
          <h1 className="font-display text-4xl font-bold">Your trips</h1>
          <p className="mt-2 text-[var(--color-ink-soft)]">{user.email}</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            await signOut();
            router.push("/");
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>

      {isLoading && <p>Loading orders…</p>}
      {!isLoading && (!orders || orders.length === 0) && (
        <div className="rounded-[20px] bg-white p-8">
          <p className="text-[var(--color-ink-soft)]">No trips yet.</p>
          <Link href="/search" className="btn-primary mt-6 inline-block">
            Reveal my 3 trips →
          </Link>
        </div>
      )}

      <ul className="space-y-4">
        {orders?.map((order) => {
          const meta = SLOT_META[order.packageSnapshot.slot];
          return (
            <li
              key={order.id}
              className="rounded-[20px] bg-white p-7 shadow-[0_1px_3px_oklch(22%_0.02_50_/_0.08)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-2xl font-bold">
                  {order.packageSnapshot.city}
                </h2>
                <span
                  className="font-mono text-xs font-bold uppercase tracking-[0.04em]"
                  style={{ color: meta.hue }}
                >
                  {order.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                {meta.label} · {formatMoney(order.totalCents, order.currency)} ·{" "}
                {new Date(order.createdAt).toLocaleDateString()}
              </p>
              <Link
                href={`/confirmation/${order.id}`}
                className="mt-4 inline-block text-sm font-semibold text-[var(--color-accent-deep)]"
              >
                View confirmation →
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
