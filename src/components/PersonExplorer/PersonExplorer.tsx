import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Person } from "../../types";
import { doiUrl, fetchPersonPapers, openAlexWorkUrl, type PersonPaper } from "../../lib/personPapers";
import { yearlyTrajectory, type TrajectoryWeight } from "../../lib/trajectory";
import YearRuler from "./YearRuler";
import ExplorerControls from "./ExplorerControls";
import PaperCube, { type CubeMode, type PaperSizeMetric, type ViewId } from "../PaperCube/PaperCube";
import "../PaperCube/PaperCube.css";
import "./PersonExplorer.css";
import { RichTitle } from "../RichTitle/RichTitle";

interface PersonExplorerProps {
  person: Person;
  /** Left-hand pane: the same detail panel the table row expands to. */
  detail: ReactNode;
  onClose: () => void;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function PersonExplorer({ person, detail, onClose }: PersonExplorerProps) {
  const [papers, setPapers] = useState<PersonPaper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<CubeMode>("papers");
  const [sizeBy, setSizeBy] = useState<PaperSizeMetric>("citations");
  const [weightBy, setWeightBy] = useState<TrajectoryWeight>("papers");
  const [ghost, setGhost] = useState(true);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [view, setView] = useState<{ id: ViewId; n: number }>({ id: "home", n: 0 });
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const pickView = (id: ViewId) => {
    setView((v) => ({ id, n: v.n + 1 }));
    setActiveView(id === "home" ? null : id);
  };
  const changeMode = (m: CubeMode) => {
    setMode(m);
    setSelected(null);
    setSelectedYear(null);
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
  const visible = useMemo(() => (papers ?? []).filter((p) => p.year >= lo && p.year <= hi), [papers, lo, hi]);
  const trajectory = useMemo(() => yearlyTrajectory(visible, weightBy), [visible, weightBy]);
  // A one-year window would collapse the Z axis; keep at least a 1-year span.
  const axisMax = hi === lo ? hi + 1 : hi;
  const sel = selected == null ? null : (visible.find((p) => p.wid === selected) ?? null);
  const selYear = selectedYear == null ? null : (trajectory.find((p) => p.year === selectedYear) ?? null);

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
          {detail}
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
              ghost={ghost}
              trajectory={trajectory}
              selectedYear={selectedYear}
              onSelectYear={setSelectedYear}
              view={view}
              onOrbit={() => setActiveView(null)}
            />
            <ExplorerControls
              mode={mode}
              onMode={changeMode}
              sizeBy={sizeBy}
              onSizeBy={setSizeBy}
              weightBy={weightBy}
              onWeightBy={setWeightBy}
              ghost={ghost}
              onGhost={setGhost}
              activeView={activeView}
              onPickView={pickView}
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
                ? `${plural(trajectory.length, "year")} · ${plural(visible.length, "paper")}`
                : plural(visible.length, "paper")}
              <span> · drag to rotate · right-drag to pan · scroll to zoom</span>
            </div>

            {mode === "papers" && sel && (
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

            {mode === "trajectory" && selYear && (
              <div className="pe-card">
                <button type="button" className="pe-card-x" onClick={() => setSelectedYear(null)} aria-label="Dismiss">
                  ✕
                </button>
                <div className="pe-card-title">{selYear.year}</div>
                <div className="pe-card-meta">
                  {plural(selYear.n, "paper")} · {plural(selYear.citations, "citation")}
                </div>
                <div className="pe-card-meta">
                  Sensing {pct(selYear.sensing)} · Communication {pct(selYear.communication)} · Computing{" "}
                  {pct(selYear.computing)}
                  {weightBy === "citations" ? " (weighted by citations)" : ""}
                </div>
                <div className="pe-card-sub">Most cited: {selYear.top.title ? <RichTitle text={selYear.top.title} /> : "(untitled)"}</div>
                <div className="pe-card-links">
                  {selYear.top.doi && (
                    <a href={doiUrl(selYear.top.doi)} target="_blank" rel="noopener noreferrer">
                      DOI ↗
                    </a>
                  )}
                  <a href={openAlexWorkUrl(selYear.top.wid)} target="_blank" rel="noopener noreferrer">
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
