import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Person } from "../../types";
import { doiUrl, fetchPersonPapers, hasUmap, openAlexWorkUrl, type PersonPaper } from "../../lib/personPapers";
import { pickHighlights } from "../../lib/highlights";
import YearRuler from "./YearRuler";
import ExplorerControls from "./ExplorerControls";
import PaperCube, { type CubeMode, type CubeSpace, type PaperSizeMetric, type UmapFrame } from "../PaperCube/PaperCube";
import "../PaperCube/PaperCube.css";
import "./PersonExplorer.css";
import { RichTitle } from "../RichTitle/RichTitle";
import { YearWindowContext, type YearWindow } from "../YearlyChart/YearWindowContext";

interface PersonExplorerProps {
  person: Person;
  /** Left-hand pane: the same detail panel the table row expands to. */
  detail: ReactNode;
  onClose: () => void;
}

// Topics space: a person's papers are scaled to roughly this many world units across (within these bounds).
const UMAP_FIT_WIDTH = 6;
const UMAP_SCALE_MIN = 3;
const UMAP_SCALE_MAX = 80;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function PersonExplorer({ person, detail, onClose }: PersonExplorerProps) {
  const [papers, setPapers] = useState<PersonPaper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CubeMode>("papers");
  const [space, setSpace] = useState<CubeSpace>("triangle");
  const [sizeBy, setSizeBy] = useState<PaperSizeMetric>("citations");
  const [ghost, setGhost] = useState(true);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState({ n: 0 }); // bump n to send the camera back to the default view
  const resetView = () => setView((v) => ({ n: v.n + 1 }));
  const changeSpace = (s: CubeSpace) => {
    setSpace(s);
    setSelected(null);
    resetView(); // the two spaces frame differently
  };
  const changeMode = (m: CubeMode) => {
    setMode(m);
    setSelected(null);
  };

  useEffect(() => {
    let alive = true;
    fetchPersonPapers(person.id)
      .then((p) => alive && setPapers(p))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [person.id]); // remounted per person (key in App), so state starts fresh

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bounds = useMemo<[number, number] | null>(() => {
    const ys = (papers ?? []).map((p) => p.year).filter((y) => y > 0);
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
  }, [papers]);

  const [lo, hi] = range ?? bounds ?? [0, 0];
  const yearCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of papers ?? []) if (p.year > 0) m.set(p.year, (m.get(p.year) ?? 0) + 1);
    return m;
  }, [papers]);
  const filtered = !!bounds && (lo !== bounds[0] || hi !== bounds[1]);
  const umapAvailable = useMemo(() => (papers ?? []).some(hasUmap), [papers]);
  // Topics space: the vertical axis passes through the middle of this person's papers and the papers are
  // scaled to fill the stage (both from the central 96 % of each coordinate, so a stray paper does not
  // dominate). Fixed over the year window so scrubbing does not move or rescale the cloud. The scale is
  // per person, so distances are not comparable between people.
  const frame = useMemo<UmapFrame>(() => {
    const range = (vals: number[]): [number, number] => {
      if (!vals.length) return [0.5, 0.5];
      vals.sort((a, b) => a - b);
      return [vals[Math.floor(0.02 * (vals.length - 1))], vals[Math.ceil(0.98 * (vals.length - 1))]];
    };
    const ps = (papers ?? []).filter(hasUmap);
    const [x0, x1] = range(ps.map((p) => p.ux));
    const [y0, y1] = range(ps.map((p) => p.uy));
    const extent = Math.max(x1 - x0, y1 - y0, 1e-3);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: Math.min(UMAP_SCALE_MAX, Math.max(UMAP_SCALE_MIN, UMAP_FIT_WIDTH / extent)) };
  }, [papers]);
  // In the Topics space only papers with a UMAP position can be placed.
  const visible = useMemo(
    () => (papers ?? []).filter((p) => p.year >= lo && p.year <= hi && (space !== "umap" || hasUmap(p))),
    [papers, lo, hi, space],
  );
  const highlights = useMemo(() => pickHighlights(visible), [visible]);
  const setWindow = (r: [number, number]) => (bounds && r[0] === bounds[0] && r[1] === bounds[1] ? setRange(null) : setRange(r));
  const yearWindow: YearWindow | null = bounds
    ? { min: bounds[0], max: bounds[1], lo, hi, filtered, onChange: setWindow, onReset: () => setRange(null) }
    : null;
  // A one-year window would collapse the Z axis; keep at least a 1-year span.
  const axisMax = hi === lo ? hi + 1 : hi;
  const sel = selected == null ? null : (visible.find((p) => p.wid === selected) ?? null);

  return (
    <div className="person-explorer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pe-modal" role="dialog" aria-modal="true" aria-label={`Details for ${person.name}`}>
        <button type="button" className="pe-close rail-btn glass-panel" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <i className="ph-light ph-x" />
        </button>
        <div className="pe-left">
          <div className="pe-head">
            <div className="pe-name">{person.name}</div>
            <div className="pe-inst">{person.institution}</div>
          </div>
          <YearWindowContext.Provider value={yearWindow}>{detail}</YearWindowContext.Provider>
        </div>

        <div className="pe-right">
          <div className="pe-stage">
            <PaperCube
              papers={visible}
              yearMin={lo}
              yearMax={axisMax}
              sizeBy={sizeBy}
              selectedWid={selected}
              onSelect={setSelected}
              mode={mode}
              space={space}
              frame={frame}
              ghost={ghost}
              highlights={highlights}
              view={view}
            />
            <ExplorerControls
              mode={mode}
              onMode={changeMode}
              space={space}
              onSpace={changeSpace}
              umapAvailable={umapAvailable}
              sizeBy={sizeBy}
              onSizeBy={setSizeBy}
              ghost={ghost}
              onGhost={setGhost}
              onResetView={resetView}
            />
            {bounds && bounds[1] > bounds[0] && (
              <YearRuler
                min={bounds[0]}
                max={bounds[1]}
                lo={lo}
                hi={hi}
                counts={yearCounts}
                filtered={filtered}
                onChange={(r) => setRange(r[0] === bounds[0] && r[1] === bounds[1] ? null : r)}
                onReset={() => setRange(null)}
              />
            )}
            {!papers && !error && <div className="pe-msg">Loading papers…</div>}
            {error && <div className="pe-msg">Couldn't load papers ({error})</div>}
            {papers && papers.length === 0 && <div className="pe-msg">No papers in the corpus for this person.</div>}
            <div className="pe-count">
              {mode === "trajectory"
                ? `${plural(highlights.length, "highlight")} · ${plural(visible.length, "paper")}`
                : plural(visible.length, "paper")}
              {space === "umap" && <span> · papers closer together are about more similar topics</span>}
              <span> · drag to rotate · right-drag to pan · scroll to zoom</span>
            </div>

            {mode === "trajectory" && (
              <div className="pe-help">
                <button type="button" className="pe-help-btn" aria-label="How the roots are drawn" aria-describedby="pe-help-tip">
                  ?
                </button>
                <div className="pe-help-tip" role="tooltip" id="pe-help-tip">
                  <b>How the roots are drawn</b>
                  <p>
                    The roots grow up the time axis through this person&rsquo;s <em>highlights</em>: for each year, the most-cited paper,
                    plus up to two more that have at least one citation (60 highlights at most; the least cited go first).
                  </p>
                  <p>
                    The roots start at the first highlight in the selected years. Every other highlight hangs off the{" "}
                    <em>nearest highlight from an earlier year</em> (or off the first one, if it is from the same year).
                    &ldquo;Nearest&rdquo; means closest on the floor plane of the current space (the domain mix, or the topic
                    map), with a little weight on how far apart in time they are. Change the years and the roots regrow from the
                    new first paper.
                  </p>
                  <p>
                    Thicker lines carry more later highlights. A branch takes the colour of the paper it ends on. The lines show
                    similarity, not citations: they do not mean one paper cites another.
                  </p>
                </div>
              </div>
            )}

            {sel && (
              <div className="pe-card">
                <button type="button" className="pe-card-x" onClick={() => setSelected(null)} aria-label="Dismiss">
                  ✕
                </button>
                <div className="pe-card-title">{sel.title ? <RichTitle text={sel.title} /> : "(untitled)"}</div>
                <div className="pe-card-meta">
                  {sel.year} · {plural(sel.citations, "citation")} · {plural(sel.authors, "author")}
                </div>
                <div className="pe-card-meta">
                  Sensing {pct(sel.sensing)} · Communication {pct(sel.communication)} · Computing {pct(sel.computing)}
                </div>
                <div className="pe-card-links">
                  {sel.doi && (
                    <a href={doiUrl(sel.doi)} target="_blank" rel="noopener noreferrer">
                      DOI ↗
                    </a>
                  )}
                  <a href={openAlexWorkUrl(sel.wid)} target="_blank" rel="noopener noreferrer">
                    OpenAlex ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
