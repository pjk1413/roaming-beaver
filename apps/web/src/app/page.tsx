import Link from "next/link";

const CLOUDS = [
  { top: 44, size: "w-[60px] h-6", opacity: 0.8, duration: 13, delay: 0 },
  { top: 96, size: "w-[78px] h-7", opacity: 0.7, duration: 17, delay: -6 },
  { top: 10, size: "w-11 h-[18px]", opacity: 0.6, duration: 15, delay: -10 },
  { top: 200, size: "w-[66px] h-[26px]", opacity: 0.75, duration: 19, delay: -3 },
  { top: 260, size: "w-[50px] h-5", opacity: 0.65, duration: 14, delay: -8 },
  { top: 150, size: "w-9 h-4", opacity: 0.6, duration: 16, delay: -12 },
  { top: 320, size: "w-[58px] h-[22px]", opacity: 0.7, duration: 18, delay: -5 },
] as const;

export default function HomePage() {
  return (
    <div className="relative overflow-hidden animate-fade-in">
      {/* Dashed flight path — top */}
      <svg
        width="100%"
        height="160"
        viewBox="0 0 1400 160"
        preserveAspectRatio="none"
        className="pointer-events-none absolute left-0 top-5 z-0 opacity-45"
        aria-hidden
      >
        <path
          d="M0,80 Q350,-10 700,75 T1400,60"
          fill="none"
          stroke="oklch(45% 0.02 50)"
          strokeWidth="2"
          strokeDasharray="2 10"
          strokeLinecap="round"
          className="animate-dash"
        />
      </svg>

      {/* Drifting clouds */}
      {CLOUDS.map((c, i) => (
        <div
          key={i}
          className={`animate-cloud pointer-events-none absolute left-[-120px] z-0 rounded-full bg-white blur-[1px] ${c.size}`}
          style={{
            top: c.top,
            opacity: c.opacity,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
          aria-hidden
        />
      ))}

      {/* Dashed flight path — bottom */}
      <svg
        width="100%"
        height="90"
        viewBox="0 0 1400 90"
        preserveAspectRatio="none"
        className="pointer-events-none absolute bottom-5 left-0 z-0 overflow-visible opacity-30"
        aria-hidden
      >
        <path
          d="M0,50 Q350,10 700,55 T1400,45"
          fill="none"
          stroke="oklch(45% 0.02 50)"
          strokeWidth="2"
          strokeDasharray="2 10"
          strokeLinecap="round"
          className="animate-dash"
          style={{ animationDuration: "3.5s" }}
        />
      </svg>

      <div className="relative z-[1] mx-auto max-w-[1100px] px-8 pb-16 pt-24 text-center">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-[oklch(62%_0.19_35_/_0.1)] px-4 py-[7px] text-[13px] font-semibold tracking-[0.01em] text-[var(--color-accent-deep)]">
          One flat price · Real itinerary · Zero browsing
        </div>
        <h1 className="mb-5 font-display text-[clamp(40px,7vw,84px)] font-bold leading-[1.02] tracking-[-0.03em]">
          You pick a date.
          <br />
          We pick the trip.
        </h1>
        <p className="mx-auto mb-10 max-w-[560px] text-[19px] leading-relaxed text-[var(--color-ink-soft)]">
          Three ready-to-book trips, each at one flat price. No browsing, no
          comparing — just pick one, pay, go.
        </p>
        <Link
          href="/search"
          className="btn-primary inline-block shadow-[0_8px_24px_oklch(22%_0.02_50_/_0.2)]"
        >
          Reveal my 3 trips →
        </Link>
      </div>

      <div className="relative z-[1] mx-auto grid max-w-[1100px] gap-6 px-8 pb-20 md:grid-cols-3">
        <StepCard
          step="STEP 01"
          hue="var(--color-hue-cheap)"
          title="Tell us three things"
          body="Home airport, dates, and how many are going. That's the whole form."
        />
        <StepCard
          step="STEP 02"
          hue="var(--color-hue-beach)"
          title="We hand back three"
          body="A cheap getaway, a beach escape, an exotic pick. Each already bookable, each one flat price."
        />
        <StepCard
          step="STEP 03"
          hue="var(--color-hue-exotic)"
          title="Pick one. Go."
          body="Full itinerary, real dates, no bidding or fees later. What you see is what you pay."
        />
      </div>

      <div className="relative z-[1] mx-auto max-w-[720px] px-8 pb-[100px] text-center">
        <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Not random luck — every trip is matched to your dates before
          it&apos;s shown to you. The mystery is the destination, never the
          price.
        </p>
      </div>
    </div>
  );
}

function StepCard({
  step,
  hue,
  title,
  body,
}: {
  step: string;
  hue: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[20px] bg-white px-7 py-8 shadow-[0_1px_3px_oklch(22%_0.02_50_/_0.08)]">
      <div
        className="mb-3.5 font-mono text-[13px] font-bold"
        style={{ color: hue }}
      >
        {step}
      </div>
      <h3 className="mb-2.5 font-display text-[22px] font-bold">{title}</h3>
      <p className="m-0 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
        {body}
      </p>
    </div>
  );
}
