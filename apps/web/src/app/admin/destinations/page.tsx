import Link from "next/link";
import {
  listDestinationsAdmin,
  listPendingReview,
  VIBE_TAGS,
} from "@mystery-trips/api";
import { ProfileStatus } from "@mystery-trips/db";
import { adminAllowlist, getAdminEmail } from "@/lib/admin";
import {
  addDestinationAction,
  approveAction,
  rejectAction,
  updateVibesAction,
} from "./actions";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: ProfileStatus }) {
  const color =
    status === "APPROVED"
      ? "text-emerald-700"
      : status === "PENDING_REVIEW"
        ? "text-amber-700"
        : status === "REJECTED"
          ? "text-red-700"
          : "text-[var(--color-ink-soft)]";
  return (
    <span className={`font-mono text-xs font-bold uppercase tracking-[0.04em] ${color}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function VibeTagPicker({
  selected = [],
  name = "vibeTags",
}: {
  selected?: string[];
  name?: string;
}) {
  const selectedSet = new Set(selected);
  return (
    <fieldset className="col-span-full">
      <legend className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-ink-soft)]">
        Vibe tags
      </legend>
      <div className="flex flex-wrap gap-2">
        {VIBE_TAGS.map((tag) => (
          <label
            key={tag}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-foam)]/40 px-2 py-1 text-xs has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-foam)]"
          >
            <input
              type="checkbox"
              name={name}
              value={tag}
              defaultChecked={selectedSet.has(tag)}
              className="accent-[var(--color-accent)]"
            />
            <span className="font-mono font-bold uppercase tracking-[0.03em]">
              {tag.replace(/_/g, " ")}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function AdminDestinationsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const email = await getAdminEmail();
  const params = await searchParams;
  const showAll = params.all === "1";

  if (!email) {
    const configured = adminAllowlist().length > 0;
    return (
      <div className="mx-auto max-w-lg px-8 py-20 text-center">
        <h1 className="mb-3 font-display text-2xl font-bold">Admin</h1>
        <p className="mb-6 text-[var(--color-ink-soft)]">
          {configured
            ? "Sign in with an allowlisted email to review destination profiles."
            : "Set ADMIN_EMAILS in apps/web/.env (comma-separated) to enable this page."}
        </p>
        <Link href="/login" className="btn-primary inline-block">
          Sign in
        </Link>
      </div>
    );
  }

  const pending = await listPendingReview();
  const all = showAll ? await listDestinationsAdmin() : [];

  return (
    <div className="mx-auto max-w-3xl px-8 pb-24 pt-10">
      <div className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
        Admin · {email}
      </div>
      <h1 className="mb-2 font-display text-3xl font-bold tracking-[-0.02em]">
        Destination profiles
      </h1>
      <p className="mb-8 text-[var(--color-ink-soft)]">
        Toggle vibe tags on review or from the full list. Profile refresh
        appends new tags the model finds relevant; it does not strip curated
        ones.
      </p>

      <section className="mb-12 rounded-2xl border border-[var(--color-line)] bg-white p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Add city</h2>
        <form action={addDestinationAction} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-left text-sm">
            <span className="mb-1 block font-mono text-xs font-bold uppercase text-[var(--color-ink-soft)]">
              City
            </span>
            <input name="city" className="field-input" required />
          </label>
          <label className="block text-left text-sm">
            <span className="mb-1 block font-mono text-xs font-bold uppercase text-[var(--color-ink-soft)]">
              Country
            </span>
            <input name="country" className="field-input" required />
          </label>
          <label className="block text-left text-sm sm:col-span-2">
            <span className="mb-1 block font-mono text-xs font-bold uppercase text-[var(--color-ink-soft)]">
              Airport (IATA)
            </span>
            <input
              name="airportCode"
              className="field-input font-mono uppercase sm:max-w-xs"
              maxLength={3}
              minLength={3}
              required
            />
          </label>
          <VibeTagPicker />
          <button type="submit" className="btn-primary sm:col-span-2">
            Add &amp; run profile pipeline →
          </button>
        </form>
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
          Optional starter tags are kept and merged with what the profile
          pipeline suggests. Requires OPENAI_API_KEY.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold">
          Pending review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Queue is empty.{" "}
            <code className="font-mono text-xs">pnpm profile-destination -- --drafts</code>{" "}
            to research DRAFT rows.
          </p>
        ) : (
          <ul className="space-y-8">
            {pending.map((d) => {
              const stay = d.stayAreas[0];
              const mapSrc = stay
                ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
                    `${stay.lng - 0.02},${stay.lat - 0.02},${stay.lng + 0.02},${stay.lat + 0.02}`,
                  )}&layer=mapnik&marker=${stay.lat}%2C${stay.lng}`
                : null;
              return (
                <li
                  key={d.id}
                  className="rounded-2xl border border-[var(--color-line)] bg-white p-5"
                >
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-lg font-bold">
                      <Link
                        href={`/admin/destinations/${d.id}`}
                        className="hover:text-[var(--color-accent)]"
                      >
                        {d.city}, {d.country}{" "}
                        <span className="font-mono text-sm text-[var(--color-accent)]">
                          {d.airportCode}
                        </span>
                      </Link>
                    </h3>
                    <StatusBadge status={d.profileStatus} />
                  </div>
                  <p className="mb-3">
                    <Link
                      href={`/admin/destinations/${d.id}`}
                      className="font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-accent)]"
                    >
                      View full profile →
                    </Link>
                  </p>
                  {stay ? (
                    <>
                      <p className="mb-1 font-semibold">{stay.name}</p>
                      <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
                        {stay.blurb}
                      </p>
                      {mapSrc ? (
                        <iframe
                          title={`Map ${stay.name}`}
                          src={mapSrc}
                          className="mb-4 h-48 w-full rounded-xl border-0"
                          loading="lazy"
                        />
                      ) : null}
                      <ul className="mb-5 space-y-2 border-l border-[var(--color-line)] pl-4">
                        {stay.activities.map((a) => (
                          <li key={a.id}>
                            <div className="font-semibold text-sm">{a.name}</div>
                            <div className="text-sm text-[var(--color-ink-soft)]">
                              {a.description}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mb-4 text-sm text-red-700">
                      No StayArea — profile may have failed.
                    </p>
                  )}
                  <form action={approveAction} className="space-y-4">
                    <input type="hidden" name="id" value={d.id} />
                    <VibeTagPicker selected={d.vibeTags} />
                    <div className="flex flex-wrap gap-3">
                      <button type="submit" className="btn-primary !px-5 !py-2.5 !text-sm">
                        Approve with tags
                      </button>
                    </div>
                  </form>
                  <form action={rejectAction} className="mt-3">
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="btn-secondary !px-5 !py-2.5 !text-sm">
                      Reject
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-bold">All destinations</h2>
          <Link
            href={showAll ? "/admin/destinations" : "/admin/destinations?all=1"}
            className="font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-accent)]"
          >
            {showAll ? "Hide list" : "Show all"}
          </Link>
        </div>
        {showAll ? (
          <ul className="space-y-4">
            {all.map((d) => (
              <li
                key={d.id}
                className="rounded-2xl border border-[var(--color-line)] bg-white p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <Link
                      href={`/admin/destinations/${d.id}`}
                      className="hover:text-[var(--color-accent)]"
                    >
                      <span className="font-mono font-bold text-[var(--color-accent)]">
                        {d.airportCode}
                      </span>{" "}
                      {d.city}, {d.country}
                    </Link>
                    {d.stayAreas[0] ? (
                      <span className="text-[var(--color-ink-soft)]">
                        {" "}
                        · {d.stayAreas[0].name}
                      </span>
                    ) : null}
                  </span>
                  <StatusBadge status={d.profileStatus} />
                </div>
                <p className="mb-3">
                  <Link
                    href={`/admin/destinations/${d.id}`}
                    className="font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-accent)]"
                  >
                    View full profile →
                  </Link>
                </p>
                <form action={updateVibesAction} className="space-y-3">
                  <input type="hidden" name="id" value={d.id} />
                  <VibeTagPicker selected={d.vibeTags} />
                  <button
                    type="submit"
                    className="btn-secondary !px-4 !py-2 !text-xs"
                  >
                    Save vibe tags
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
