import { useContext, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Person } from "../../types";
import { YearWindowContext } from "./YearWindowContext";
import "./YearlyChart.css";

type Yearly = NonNullable<Person["yearly"]>;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type Grab = "lo" | "hi" | "band";

type MetricKey = "papers" | "citations" | "new_coauthors";

const METRICS: Record<MetricKey, { label: string; unit: [string, string] }> = {
  papers: { label: "Papers per year", unit: ["paper", "papers"] },
  citations: { label: "Citations per year", unit: ["citation", "citations"] },
  new_coauthors: { label: "New coauthors per year", unit: ["new coauthor", "new coauthors"] },
};

/**
 * Editorial bar chart of a person's yearly output, with a dropdown to switch the
 * measure. Years are continuous (gaps show as empty slots). "Citations" are those
 * earned by papers published that year. "New coauthors" only appears when the data
 * carries that field.
 */
export default function YearlyChart({ yearly }: { yearly: Yearly }) {
  const available = (Object.keys(METRICS) as MetricKey[]).filter(
    (k) => k !== "new_coauthors" || Object.values(yearly).some((v) => typeof v.new_coauthors === "number"),
  );
  const [metric, setMetric] = useState<MetricKey>("papers");
  const [hover, setHover] = useState<number | null>(null);
  const win = useContext(YearWindowContext);
  const stripRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ kind: Grab; startYear: number; startLo: number; startHi: number } | null>(null);

  const keys = Object.keys(yearly).map(Number);
  if (keys.length < 2) return null;
  // Inside the explorer the axis is the ruler's own extent, so the handles can reach
  // "everything" exactly; elsewhere it spans the years we have data for.
  const first = win ? win.min : Math.min(...keys);
  const last = win ? win.max : Math.max(...keys);
  const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const valueOf = (y: number) => yearly[String(y)]?.[metric] ?? 0;
  const max = Math.max(1, ...years.map(valueOf));
  const peak = years.reduce((best, y) => (valueOf(y) > valueOf(best) ? y : best), first);
  const fmt = (n: number) => n.toLocaleString("en-US");
  const noun = (n: number) => METRICS[metric].unit[n === 1 ? 0 : 1];

  // --- optional year window, shared with the explorer's vertical ruler ---
  const n = years.length;
  const wlo = win ? win.lo : first;
  const whi = win ? win.hi : last;
  const yearAt = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    const y = first + Math.floor(((clientX - r.left) / r.width) * n);
    return clamp(y, first, last);
  };
  const begin = (kind: Grab) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grab.current = { kind, startYear: yearAt(e.clientX), startLo: wlo, startHi: whi };
  };
  const move = (e: PointerEvent) => {
    const g = grab.current;
    if (!g || !win) return;
    const yr = yearAt(e.clientX);
    if (g.kind === "lo") win.onChange([Math.min(yr, g.startHi), g.startHi]);
    else if (g.kind === "hi") win.onChange([g.startLo, Math.max(yr, g.startLo)]);
    else {
      const d = clamp(yr - g.startYear, win.min - g.startLo, win.max - g.startHi);
      win.onChange([g.startLo + d, g.startHi + d]);
    }
  };
  const end = () => {
    grab.current = null;
  };
  const onTrackDown = (e: PointerEvent) => {
    if (!win) return;
    const yr = yearAt(e.clientX);
    if (yr > whi) win.onChange([wlo, yr]);
    else if (yr < wlo) win.onChange([yr, whi]);
  };
  const key = (which: "lo" | "hi") => (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d || !win) return;
    e.preventDefault();
    if (which === "lo") win.onChange([clamp(wlo + d, win.min, whi), whi]);
    else win.onChange([wlo, clamp(whi + d, wlo, win.max)]);
  };
  const left = (y: number) => `${((y - first) / n) * 100}%`;

  return (
    <div className="yc">
      <div className="yc-head">
        <select
          className="yc-select"
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricKey)}
          aria-label="Measure shown in the yearly chart"
        >
          {available.map((k) => (
            <option key={k} value={k}>
              {METRICS[k].label}
            </option>
          ))}
        </select>
        <span className="yc-star" aria-hidden="true">
          *
        </span>
        <span className="yc-readout" aria-live="polite">
          {hover !== null ? (
            <>
              <i>{hover}</i> · {fmt(valueOf(hover))} {noun(valueOf(hover))}
            </>
          ) : (
            <>
              peak <i>{peak}</i> · {fmt(valueOf(peak))}
            </>
          )}
        </span>
      </div>
      <div className="yc-bars" onMouseLeave={() => setHover(null)}>
        {years.map((y) => {
          const v = valueOf(y);
          return (
            <div
              key={y}
              className={"yc-slot" + (hover === y ? " is-hover" : "") + (win && (y < wlo || y > whi) ? " is-out" : "")}
              onMouseEnter={() => setHover(y)}
              title={`${y}: ${fmt(v)} ${noun(v)}`}
            >
              <div className={"yc-bar" + (v === 0 ? " is-zero" : "")} style={{ height: v === 0 ? undefined : `${Math.max(4, (v / max) * 100)}%` }} />
            </div>
          );
        })}
      </div>
      {win && (
        <div className="yc-range" ref={stripRef} onPointerDown={onTrackDown} aria-label="Year range">
          <div className="yc-range-line" />
          <div
            className="yc-range-band"
            style={{ left: left(wlo), width: `${((whi - wlo + 1) / n) * 100}%` }}
            onPointerDown={begin("band")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {(
            [
              ["lo", left(wlo), wlo],
              ["hi", left(whi + 1), whi],
            ] as const
          ).map(([which, x, yr]) => (
            <div
              key={which}
              className="yc-range-handle"
              style={{ left: x }}
              role="slider"
              tabIndex={0}
              aria-label={which === "hi" ? "Latest year" : "Earliest year"}
              aria-valuemin={first}
              aria-valuemax={last}
              aria-valuenow={yr}
              onPointerDown={begin(which)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={key(which)}
            />
          ))}
        </div>
      )}
      <div className="yc-axis">
        <span>{win && win.filtered ? wlo : first}</span>
        {win && win.filtered && (
          <button type="button" className="yc-reset" onClick={win.onReset}>
            show all {first}–{last}
          </button>
        )}
        <span>{win && win.filtered ? whi : last}</span>
      </div>
      <div className="yc-note">* quantum corpus only</div>
    </div>
  );
}
