import Link from "next/link";
import { notFound } from "next/navigation";
import { getDestinationAdmin, VIBE_TAGS } from "@mystery-trips/api";
import { ProfileStatus } from "@mystery-trips/db";
import { adminAllowlist, getAdminEmail } from "@/lib/admin";
import {
  approveAction,
  rejectAction,
  updateVibesAction,
} from "../actions";

export const dynamic = "force-dynamic";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CATEGORY_ORDER = ["food", "sight", "activity", "nightlife"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  food: "Food & drink",
  sight: "Sights & places",
  activity: "Things to do",
  nightlife: "Nightlife",
};

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
    <span
      className={`font-mono text-xs font-bold uppercase tracking-[0.04em] ${color}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function VibeTagPicker({ selected = [] }: { selected?: string[] }) {
  const selectedSet = new Set(selected);
  return (
    <fieldset>
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
              name="vibeTags"
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

function groupActivities(
  activities: Array<{
    id: string;
    name: string;
    description: string;
    category: string | null;
    lat: number | null;
    lng: number | null;
  }>,
) {
  const groups = new Map<string, typeof activities>();
  for (const a of activities) {
    const key = a.category?.toLowerCase() || "other";
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  const ordered: Array<[string, typeof activities]> = [];
  for (const cat of CATEGORY_ORDER) {
    const list = groups.get(cat);
    if (list?.length) ordered.push([cat, list]);
  }
  for (const [key, list] of groups) {
    if (!(CATEGORY_ORDER as readonly string[]).includes(key)) {
      ordered.push([key, list]);
    }
  }
  return ordered;
}

function osmEmbed(lat: number, lng: number, pad = 0.025) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    `${lng - pad},${lat - pad},${lng + pad},${lat + pad}`,
  )}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export default async function AdminDestinationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const email = await getAdminEmail();
  const { id } = await params;

  if (!email) {
    const configured = adminAllowlist().length > 0;
    return (
      <div className="mx-auto max-w-lg px-8 py-20 text-center">
        <h1 className="mb-3 font-display text-2xl font-bold">Admin</h1>
        <p className="mb-6 text-[var(--color-ink-soft)]">
          {configured
            ? "Sign in with an allowlisted email to view destination profiles."
            : "Set ADMIN_EMAILS in apps/web/.env to enable this page."}
        </p>
        <Link href="/login" className="btn-primary inline-block">
          Sign in
        </Link>
      </div>
    );
  }

  const d = await getDestinationAdmin(id);
  if (!d) notFound();

  const temps = Array.isArray(d.avgTempByMonthC)
    ? (d.avgTempByMonthC as number[])
    : null;
  const activityCount = d.stayAreas.reduce(
    (n, s) => n + s.activities.length,
    0,
  );

  return (
    <div className="mx-auto max-w-3xl px-8 pb-24 pt-10">
      <Link
        href="/admin/destinations?all=1"
        className="mb-6 inline-block font-mono text-xs font-bold uppercase tracking-[0.03em] text-[var(--color-accent)]"
      >
        ← All destinations
      </Link>

      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
          Admin · full profile
        </div>
        <StatusBadge status={d.profileStatus} />
      </div>

      <h1 className="mb-1 font-display text-3xl font-bold tracking-[-0.02em]">
        {d.city}, {d.country}
      </h1>
      <p className="mb-6 font-mono text-sm text-[var(--color-ink-soft)]">
        {d.airportCode}
        {d.airportLat != null && d.airportLng != null
          ? ` · airport ${d.airportLat.toFixed(4)}, ${d.airportLng.toFixed(4)}`
          : ""}
        {" · "}
        {d.stayAreas.length} stay area
        {d.stayAreas.length === 1 ? "" : "s"} · {activityCount} place
        {activityCount === 1 ? "" : "s"} · {d.images.length} photo
        {d.images.length === 1 ? "" : "s"}
      </p>

      {d.vibeTags.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-1.5">
          {d.vibeTags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-[var(--color-foam)] px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--color-ink-soft)]"
            >
              {t.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ) : null}

      {d.notes ? (
        <p className="mb-8 border-l-2 border-[var(--color-accent)] pl-4 text-sm text-[var(--color-ink-soft)]">
          {d.notes}
        </p>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 font-display text-lg font-bold">
          Photos ({d.images.length})
        </h2>
        {d.images.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            No images yet — re-run profile/refresh to fetch Wikipedia, Commons,
            and optional Unsplash photos.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {d.images.map((img) => (
              <figure
                key={img.id}
                className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl || img.url}
                  alt={img.caption || d.city}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
                <figcaption className="space-y-0.5 p-2 font-mono text-[10px] text-[var(--color-ink-soft)]">
                  <div className="font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
                    {img.kind}
                    {img.source ? ` · ${img.source}` : ""}
                  </div>
                  {img.caption ? (
                    <div className="line-clamp-2">{img.caption}</div>
                  ) : null}
                  {img.attribution ? (
                    <div className="line-clamp-2">{img.attribution}</div>
                  ) : null}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {temps && temps.length === 12 ? (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-lg font-bold">
            Avg temp °C by month
          </h2>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
            {temps.map((t, i) => (
              <div
                key={MONTHS[i]}
                className="rounded-lg border border-[var(--color-line)] bg-white px-1 py-2 text-center"
              >
                <div className="font-mono text-[10px] font-bold uppercase text-[var(--color-ink-soft)]">
                  {MONTHS[i]}
                </div>
                <div className="text-sm font-semibold">{Math.round(t)}°</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-10 space-y-10">
        <h2 className="font-display text-xl font-bold">Stay areas & places</h2>
        {d.stayAreas.length === 0 ? (
          <p className="text-sm text-red-700">
            No stay areas yet — run the profile pipeline.
          </p>
        ) : (
          d.stayAreas.map((stay) => {
            const grouped = groupActivities(stay.activities);
            return (
              <article
                key={stay.id}
                className="rounded-2xl border border-[var(--color-line)] bg-white p-5"
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-2">
                  <h3 className="font-display text-lg font-bold">{stay.name}</h3>
                  {stay.isPrimary ? (
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
                      Primary
                    </span>
                  ) : null}
                </div>
                <p className="mb-1 font-mono text-xs text-[var(--color-ink-soft)]">
                  {stay.lat.toFixed(5)}, {stay.lng.toFixed(5)}
                </p>
                <p className="mb-4 text-sm text-[var(--color-ink-soft)]">
                  {stay.blurb}
                </p>
                <iframe
                  title={`Map ${stay.name}`}
                  src={osmEmbed(stay.lat, stay.lng)}
                  className="mb-6 h-52 w-full rounded-xl border-0"
                  loading="lazy"
                />

                {grouped.length === 0 ? (
                  <p className="text-sm text-[var(--color-ink-soft)]">
                    No activities listed for this area.
                  </p>
                ) : (
                  <div className="space-y-6">
                    {grouped.map(([cat, items]) => (
                      <div key={cat}>
                        <h4 className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-accent)]">
                          {CATEGORY_LABEL[cat] ?? cat}
                        </h4>
                        <ul className="space-y-3 border-l border-[var(--color-line)] pl-4">
                          {items.map((a) => (
                            <li key={a.id}>
                              <div className="text-sm font-semibold">
                                {a.name}
                              </div>
                              <div className="text-sm text-[var(--color-ink-soft)]">
                                {a.description}
                              </div>
                              {a.lat != null && a.lng != null ? (
                                <div className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-soft)]">
                                  {a.lat.toFixed(4)}, {a.lng.toFixed(4)}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      <section className="mb-8 rounded-2xl border border-[var(--color-line)] bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold">Edit vibe tags</h2>
        <form action={updateVibesAction} className="space-y-4">
          <input type="hidden" name="id" value={d.id} />
          <VibeTagPicker selected={d.vibeTags} />
          <button type="submit" className="btn-secondary !px-4 !py-2 !text-sm">
            Save vibe tags
          </button>
        </form>
      </section>

      {d.profileStatus === ProfileStatus.PENDING_REVIEW ? (
        <section className="mb-8 flex flex-wrap gap-3">
          <form action={approveAction}>
            <input type="hidden" name="id" value={d.id} />
            {d.vibeTags.map((t) => (
              <input key={t} type="hidden" name="vibeTags" value={t} />
            ))}
            <button type="submit" className="btn-primary !px-5 !py-2.5 !text-sm">
              Approve
            </button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="id" value={d.id} />
            <button
              type="submit"
              className="btn-secondary !px-5 !py-2.5 !text-sm"
            >
              Reject
            </button>
          </form>
        </section>
      ) : null}

      <dl className="grid gap-2 font-mono text-xs text-[var(--color-ink-soft)] sm:grid-cols-2">
        <div>
          <dt className="font-bold uppercase tracking-[0.04em]">Profiled</dt>
          <dd>{d.profiledAt?.toISOString() ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-[0.04em]">Reviewed</dt>
          <dd>
            {d.reviewedAt
              ? `${d.reviewedAt.toISOString()}${d.reviewedBy ? ` · ${d.reviewedBy}` : ""}`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-[0.04em]">Transit</dt>
          <dd>{d.hasGoodPublicTransit ? "Good" : "Limited"}</dd>
        </div>
        <div>
          <dt className="font-bold uppercase tracking-[0.04em]">Metro rank</dt>
          <dd>{d.metroRank ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-bold uppercase tracking-[0.04em]">ID</dt>
          <dd className="break-all">{d.id}</dd>
        </div>
      </dl>
    </div>
  );
}
