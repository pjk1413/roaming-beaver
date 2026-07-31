/** Letter-flap reveal matching the design's flapIn animation. */
export function FlapText({
  text,
  className = "",
  baseDelaySec = 0.4,
  staggerSec = 0.03,
}: {
  text: string;
  className?: string;
  baseDelaySec?: number;
  staggerSec?: number;
}) {
  return (
    <div
      className={`flex flex-wrap [perspective:400px] ${className}`}
      aria-label={text}
    >
      {text.split("").map((ch, i) => (
        <span
          key={`${ch}-${i}`}
          className="animate-flap font-display text-2xl font-bold"
          style={{ animationDelay: `${baseDelaySec + i * staggerSec}s` }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </div>
  );
}
