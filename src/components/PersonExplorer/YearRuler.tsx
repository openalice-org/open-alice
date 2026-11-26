import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import "./YearRuler.css";

interface YearRulerProps {
  /** Full extent of the person's papers. */
  min: number;
  max: number;
  /** Currently selected window (equals [min, max] when unfiltered). */
  lo: number;
  hi: number;
  /** Papers per year over the full extent, for the histogram. */
  counts: Map<number, number>;
  /** True when the window is narrower than the full extent. */
  filtered: boolean;
  onChange: (range: [number, number]) => void;
  onReset: () => void;
}

type Grab = "lo" | "hi" | "band";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const step = [1, 2, 5, 10, 20].find((s) => span / s <= 8) ?? 20;
  const out: number[] = [];
  for (let y = Math.ceil(min / step) * step; y <= max; y += step) out.push(y);
  return out;
}

/**
 * Vertical year ruler: newest at the top (matching the 3D time axis). Drag the
 * top/bottom handle to set the window's end/start, drag the band to slide it,
 * or click the track to jump the nearest handle.
 */
export default function YearRuler({ min, max, lo, hi, counts, filtered, onChange, onReset }: YearRulerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ kind: Grab; startYear: number; startLo: number; startHi: number } | null>(null);
  const span = Math.max(1, max - min);
  const pct = (y: number) => ((max - y) / span) * 100;
  const peak = useMemo(() => Math.max(1, ...counts.values()), [counts]);
  const ticks = useMemo(() => niceTicks(min, max), [min, max]);

  const yearAt = useCallback(
    (clientY: number) => {
      const r = trackRef.current!.getBoundingClientRect();
      return clamp(Math.round(max - ((clientY - r.top) / r.height) * span), min, max);
    },
    [min, max, span],
  );

  const begin = (kind: Grab) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grab.current = { kind, startYear: yearAt(e.clientY), startLo: lo, startHi: hi };
  };

  const move = (e: PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    const yr = yearAt(e.clientY);
    if (g.kind === "lo") onChange([Math.min(yr, g.startHi), g.startHi]);
    else if (g.kind === "hi") onChange([g.startLo, Math.max(yr, g.startLo)]);
    else {
      const d = clamp(yr - g.startYear, min - g.startLo, max - g.startHi);
      onChange([g.startLo + d, g.startHi + d]);
    }
  };

  const end = () => {
    grab.current = null;
  };

  const onTrackDown = (e: PointerEvent) => {
    const yr = yearAt(e.clientY);
    if (yr > hi) onChange([lo, yr]);
    else if (yr < lo) onChange([yr, hi]);
  };

  const key = (which: "lo" | "hi") => (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    if (which === "lo") onChange([clamp(lo + d, min, hi), hi]);
    else onChange([lo, clamp(hi + d, lo, max)]);
  };

  const slotH = 100 / (span + 1);
  const hideNear = (y: number) => Math.abs(pct(y) - pct(lo)) < 5 || Math.abs(pct(y) - pct(hi)) < 5;

  return (
    <div className="year-ruler" aria-label="Year range">
      <div className="yr-readout">
        {lo === hi ? lo : `${lo}–${hi}`}
      </div>

      <div className="yr-track" ref={trackRef} onPointerDown={onTrackDown}>
        <div className="yr-line" />

        {Array.from({ length: span + 1 }, (_, i) => max - i).map((y) => {
          const n = counts.get(y) ?? 0;
          if (!n) return null;
          return (
            <div
              key={y}
              className={"yr-bar" + (y >= lo && y <= hi ? " in" : "")}
              style={{
                top: `${pct(y)}%`,
                height: `calc(${slotH}% - 1px)`,
                width: `${4 + (n / peak) * 20}px`,
                // same bottom-to-top order and pace as the papers appearing in the 3D view
                animationDelay: `${((y - min) / span) * 750}ms`,
              }}
              title={`${y}: ${n} paper${n === 1 ? "" : "s"}`}
            />
          );
        })}

        {ticks.map((y) =>
          hideNear(y) ? null : (
            <div key={y} className="yr-tick" style={{ top: `${pct(y)}%` }}>
              <i />
              <span>{y}</span>
            </div>
          ),
        )}

        <div
          className="yr-band"
          style={{ top: `${pct(hi)}%`, height: `${pct(lo) - pct(hi)}%` }}
          onPointerDown={begin("band")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />

        {(
          [
            ["hi", hi],
            ["lo", lo],
          ] as const
        ).map(([which, yr]) => (
          <div
            key={which}
            className="yr-handle"
            style={{ top: `${pct(yr)}%` }}
            role="slider"
            tabIndex={0}
            aria-label={which === "hi" ? "Latest year" : "Earliest year"}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={yr}
            onPointerDown={begin(which)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={key(which)}
          >
            <b />
            <span>{yr}</span>
          </div>
        ))}
      </div>

      <button type="button" className={"yr-reset" + (filtered ? "" : " idle")} onClick={onReset}>
        Reset
      </button>
    </div>
  );
}
