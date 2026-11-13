import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Person } from "../../types";
import { doiUrl, fetchPersonPapers, openAlexWorkUrl, type PersonPaper } from "../../lib/personPapers";
import YearRuler from "./YearRuler";
import PaperCube, { type PaperSizeMetric, type ViewId } from "../PaperCube/PaperCube";
import ViewPresets from "./ViewPresets";
import "../PaperCube/PaperCube.css";
import "./PersonExplorer.css";

interface PersonExplorerProps {
  person: Person;
  /** Left-hand pane: the same detail panel the table row expands to. */
  detail: ReactNode;
  onClose: () => void;
}

const SIZE_OPTIONS: { value: PaperSizeMetric; label: string }[] = [
  { value: "citations", label: "Citations" },
  { value: "coauthors", label: "Coauthors" },
  { value: "constant", label: "Same size" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function PersonExplorer({ person, detail, onClose }: PersonExplorerProps) {
  const [papers, setPapers] = useState<PersonPaper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeBy, setSizeBy] = useState<PaperSizeMetric>("citations");
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<{ id: ViewId; n: number }>({ id: "home", n: 0 });
  const [activeView, setActiveView] = useState<ViewId | null>(null);
  const pickView = (id: ViewId) => {
    setView((v) => ({ id, n: v.n + 1 }));
    setActiveView(id === "home" ? null : id);
  };

  useEffect(() => {
    let alive = true;
    fetchPersonPapers(person.id)
      .then((p) => alive && setPapers(p))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [person.id]); // remounted per person (key in TableView), so state starts fresh

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
  const visible = useMemo(
    () => (papers ?? []).filter((p) => p.year >= lo && p.year <= hi),
    [papers, lo, hi],
  );
  // A one-year window would collapse the Z axis; keep at least a 1-year span.
  const axisMax = hi === lo ? hi + 1 : hi;
  const sel = selected == null ? null : visible.find((p) => p.wid === selected) ?? null;

  return (
    <div
      className="person-explorer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pe-modal" role="dialog" aria-modal="true" aria-label={`Details for ${person.name}`}>
      <div className="pe-left">
        <div className="pe-head">
          <div className="pe-name">{person.name}</div>
          <div className="pe-inst">{person.institution}</div>
        </div>
        {detail}
      </div>

      <div className="pe-right">
        <div className="pe-toolbar">
          <label>
            Size by
            <select value={sizeBy} onChange={(e) => setSizeBy(e.target.value as PaperSizeMetric)}>
              {SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => pickView("home")}>
            Reset view
          </button>
          <button type="button" className="pe-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="pe-stage">
          <PaperCube
            papers={visible}
            yearMin={lo}
            yearMax={axisMax}
            sizeBy={sizeBy}
            selectedWid={selected}
            onSelect={setSelected}
            view={view}
            onOrbit={() => setActiveView(null)}
          />
          <ViewPresets active={activeView} onPick={pickView} />
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
            {visible.length} paper{visible.length === 1 ? "" : "s"}
            <span> · drag to rotate · right-drag to pan · scroll to zoom</span>
          </div>

          {sel && (
            <div className="pe-card">
              <button type="button" className="pe-card-x" onClick={() => setSelected(null)} aria-label="Dismiss">
                ✕
              </button>
              <div className="pe-card-title">{sel.title || "(untitled)"}</div>
              <div className="pe-card-meta">
                {sel.year} · {sel.citations} citation{sel.citations === 1 ? "" : "s"} · {sel.authors} author
                {sel.authors === 1 ? "" : "s"}
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
