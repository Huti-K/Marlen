import type { AgentCard, ChartPoint, ChartTone } from "@marlen/shared";
import { BarChart3, LineChart } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { stagger } from "@/lib/utils";
import { CardShell } from "./CardShell";

type ChartData = Extract<AgentCard, { kind: "chart" }>;

/** A point's color by meaning; the accent is the unmarked default. */
const TONE_BG: Record<ChartTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground",
};

/**
 * A small bar or line chart of the numbers the agent is explaining. Borderless,
 * axis-free (structure from space, per DESIGN): bars are labelled rows with the
 * value at the end; a line is a sparkline with its scale shown at the corners.
 * One accent tone by default; a point's `tone` recolors its bar by meaning.
 */
export function ChartCard({ card }: { card: ChartData }) {
  const { t, i18n } = useTranslation();
  const { chartType, title, unit, points } = card;

  const fmt = (v: number) => {
    const n = Number.isInteger(v)
      ? v.toLocaleString(i18n.language)
      : v.toLocaleString(i18n.language, { maximumFractionDigits: 2 });
    if (!unit) return n;
    return unit.length <= 1 ? `${n}${unit}` : `${n} ${unit}`;
  };

  return (
    <CardShell
      icon={chartType === "line" ? LineChart : BarChart3}
      label={t("chat.cards.chart.badge")}
      meta={t("chat.cards.chart.pointCount", { count: points.length })}
      title={title}
    >
      <div
        className="px-4 pb-4 pt-1"
        role="img"
        aria-label={t("chat.cards.chart.alt", { title: title ?? t("chat.cards.chart.badge") })}
      >
        {chartType === "line" ? (
          <LinePlot points={points} fmt={fmt} />
        ) : (
          <BarPlot points={points} fmt={fmt} />
        )}
      </div>
    </CardShell>
  );
}

/**
 * Rolls a value from 0 to its final number while its bar grows. Integer
 * targets stay integers mid-flight so the format never flickers decimals.
 */
function AnimatedValue({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  const [shown, setShown] = React.useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0,
  );
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - p) ** 3;
      setShown(Number.isInteger(value) ? Math.round(value * eased) : value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(shown)}</>;
}

function BarPlot({ points, fmt }: { points: ChartPoint[]; fmt: (v: number) => string }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  return (
    <div className="flex flex-col gap-1.5">
      {points.map((point, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list from one card, order stable, labels can repeat
          key={i}
          className="grid grid-cols-[minmax(3.5rem,7rem)_1fr_auto] items-center gap-3"
        >
          <span className="truncate text-xs text-foreground/90">{point.label}</span>
          <div className="h-2.5 overflow-hidden rounded bg-muted">
            <div
              className={`chart-bar-in h-full rounded ${TONE_BG[point.tone ?? "accent"]}`}
              style={{
                width: `${max > 0 ? Math.max(0, (point.value / max) * 100) : 0}%`,
                ...stagger(i),
              }}
            />
          </div>
          <span className="text-right font-mono text-2xs text-muted-foreground tabular-nums">
            <AnimatedValue value={point.value} fmt={fmt} />
          </span>
        </div>
      ))}
    </div>
  );
}

function LinePlot({ points, fmt }: { points: ChartPoint[]; fmt: (v: number) => string }) {
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  // Percent coordinates in a 0..100 box; y inverts so larger sits higher.
  const coord = (v: number, i: number) => ({
    x: points.length > 1 ? (i / (points.length - 1)) * 100 : 50,
    y: 100 - ((v - min) / span) * 100,
  });
  const pts = points.map((p, i) => coord(p.value, i));
  const polyline = pts.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `0,100 ${polyline} 100,100`;
  // With few points, name each value; more than that would clutter the line.
  const labelEach = points.length <= 6;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-28">
        {/* Scale reference at the corners, in lieu of a y-axis. */}
        <span className="absolute left-0 top-0 font-mono text-3xs text-muted-foreground tabular-nums">
          {fmt(max)}
        </span>
        {min !== max && (
          <span className="absolute bottom-0 left-0 font-mono text-3xs text-muted-foreground tabular-nums">
            {fmt(min)}
          </span>
        )}
        <svg
          className="h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon points={area} fill="var(--accent)" fillOpacity={0.1} />
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Perfect-circle dots as HTML, so preserveAspectRatio="none" can't warp them. */}
        {pts.map((c, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list from one card, order stable
            key={i}
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${c.x}%`, top: `${c.y}%` }}
          />
        ))}
        {/* Surface-toned cover sliding aside reveals the plot left to right, so
            the line reads as drawn. Clipped by an oversized wrapper (not the
            plot box) so the edge dots' overhang stays unclipped at rest. */}
        <div className="pointer-events-none absolute -inset-1 overflow-hidden" aria-hidden>
          <div className="chart-reveal absolute inset-0 bg-surface" />
        </div>
      </div>
      <div className="flex justify-between gap-2 font-mono text-2xs text-muted-foreground tabular-nums">
        {points.map((point, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list from one card, order stable
            key={i}
            className="min-w-0 flex-1 truncate text-center first:text-left last:text-right"
          >
            {point.label}
            {labelEach && <span className="text-foreground/70"> · {fmt(point.value)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
