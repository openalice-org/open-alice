import { useEffect, useMemo, useRef, useState } from "react";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition"; // augments Selection with .transition() used below
import { scaleSqrt } from "d3-scale";
import { max } from "d3-array";
import { useAppState } from "../../state/AppState";
import { useTaxonomyDataset } from "../../hooks/useTaxonomyDataset";
import type { Collaborations, PaperCounts, PatentLinks, TaxPerson } from "../../types";
import { fmtInt } from "../../lib/format";
import { filterByTimeWindow } from "../../lib/people";
import { countryOfScope, NORDICS_SCOPE } from "../../lib/institutions";
import {
  TAX_UNIS,
  TAX_UNI_COUNTRY,
  computeRings,
  buildSunLayout,
  buildPathIndex,
  arcPathFor,
  arcFill,
  sectorBandPath,
  curvedLabelGeom,
  fitLabelText,
  labelPathId,
  taxNodePath,
  anchorNodeFor,
  anchorFor,
  taxColour,
} from "../../lib/taxonomy";
import { buildMosaic, isUniOwner, type AnchorEntry, type MosaicOwner } from "../../lib/mosaic";
import Tooltip from "../Tooltip/Tooltip";
import "./TaxonomyView.css";

interface Dot {
  person: TaxPerson;
  x: number;
  y: number;
  r: number;
  color: string;
}

interface RosterRow {
  id: string;
  label: string;
  sub: string;
  isUniversity: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Small inline hover/click card for a country-wheel "university" mosaic
 * tile — a synthetic aggregate, not a TaxPerson, so it isn't a fit for
 * <Tooltip> (which requires a full Person shape). Reuses Tooltip.css's
 * classes (already loaded globally by <Tooltip> elsewhere in this view) so
 * it matches the real tooltip's visual style. */
function UniversityCard({
  name,
  arcName,
  people,
  totalPeople,
  papers,
  totalPapers,
  x,
  y,
}: {
  name: string;
  arcName: string;
  people: number;
  totalPeople: number;
  papers: number;
  totalPapers: number;
  x: number;
  y: number;
}) {
  // Wider than a plain stat card — the "Quantum papers on {arcName}" row's
  // label can run long (a subfield name plus the fixed "Quantum papers on"
  // prefix) and was cropping/overlapping its value at the old 260px.
  const width = 340;
  const left = clamp(x + 16, 8, window.innerWidth - width - 8);
  const top = clamp(y + 16, 8, window.innerHeight - 200);
  const researchers = people === totalPeople ? fmtInt(people) : `${fmtInt(people)} of ${fmtInt(totalPeople)}`;
  const quantumPapers = papers === totalPapers ? fmtInt(papers) : `${fmtInt(papers)} of ${fmtInt(totalPapers)}`;
  return (
    <div className="tooltip glass-panel" style={{ left, top, width }}>
      <div className="tip-head">
        <div>
          <h3>{name}</h3>
          <div className="inst">Click to open this university&rsquo;s disciplines</div>
        </div>
      </div>
      <div className="row">
        <span>Researchers</span>
        <b>{researchers}</b>
      </div>
      <div className="row">
        <span>Quantum papers on {arcName}</span>
        <b>{quantumPapers}</b>
      </div>
    </div>
  );
}

interface TaxonomyViewProps {
  /** Distinct-paper counts (see PaperCounts' doc) — used to show a
   * university's real paper total on the country/Nordics wheel's roster
   * instead of summing each person's own quantum_papers, which double-
   * counts any paper co-authored by two people at the same university.
   * Optional: a dataset built before paper_counts_geo.json existed falls
   * back to the summed (over-)count for that one university. */
  paperCounts?: PaperCounts | null;
  patentLinks?: PatentLinks | null;
  collaborations?: Collaborations | null;
  knownPersonIds?: Set<string>;
}

export default function TaxonomyView({
  paperCounts,
  patentLinks,
  collaborations,
  knownPersonIds,
}: TaxonomyViewProps = {}) {
  const { state, dispatch } = useAppState();
  const { data, loading, error } = useTaxonomyDataset();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [size, setSize] = useState({ width: 900, height: 700 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Set ONLY by hovering a mosaic tile, never a roster row — the roster's
  // hover/click should highlight the matching tile (via hoveredId/
  // lockedRosterId, both feed highlightedId below) without ever popping the
  // tooltip; only actually hovering (or pinning) the mosaic itself should.
  const [hoveredMosaicId, setHoveredMosaicId] = useState<string | null>(null);
  const [hoverScreen, setHoverScreen] = useState<{ x: number; y: number } | null>(null);
  const [lockedRosterId, setLockedRosterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The exact mosaic tile owner under the cursor, captured directly at
  // hover-time — a university can have separate islands (and separate local
  // people/papers counts) in many different arcs, so highlightedId alone
  // (used for cross-arc dim/outline highlighting) isn't enough to know which
  // specific arc's numbers the hover card should show.
  const [hoveredOwner, setHoveredOwner] = useState<MosaicOwner | null>(null);
  // Roster row elements keyed by row id, so a mosaic hover can scroll the
  // matching row into view without re-querying the DOM by id/class.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  // ---- measure the container, mirroring ScatterView's approach but via
  // ResizeObserver so the wheel also reacts to the roster/rail panels
  // changing layout, not just window resizes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- d3-zoom, attached imperatively; transform mirrored into React state
  // (same pattern as ScatterView.tsx).
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = z;
    const sel = select(svgRef.current);
    sel.call(z);
    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  // ---- navigating between wheels (country <-> university) reuses this same
  // mounted component (AppState's SET_SCOPE keeps mapMode "taxonomy" as long
  // as the new scope is still allowed) — reset per-scope interaction state
  // and the zoom transform so a stale view of the old wheel never lingers.
  useEffect(() => {
    setTransform(zoomIdentity);
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).interrupt().call(zoomRef.current.transform, zoomIdentity);
    }
    setLockedRosterId(null);
    setHoveredId(null);
    setHoveredMosaicId(null);
    setHoverScreen(null);
    setHoveredOwner(null);
    setQuery("");
  }, [state.scope]);

  // "Multi-uni wheel": country: scopes and Nordics both roll several
  // universities into one wheel with a per-university roster/mosaic
  // breakdown, as opposed to a single-university scope. Kept the
  // isCountryWheel name (used throughout this file and mosaic.ts) even
  // though it now also covers Nordics — renaming it everywhere would be a
  // much bigger diff for no behavior change.
  const isCountryWheel = state.scope.startsWith("country:") || state.scope === NORDICS_SCOPE;
  const wheelCountry = countryOfScope(state.scope);

  const scopedPeople = useMemo<TaxPerson[]>(() => {
    if (!data) return [];
    const base = wheelCountry
      ? data.people.filter((p) => TAX_UNI_COUNTRY.get(p.university) === wheelCountry)
      : state.scope === NORDICS_SCOPE
        ? data.people.filter((p) => TAX_UNIS.has(p.university))
        : data.people.filter((p) => p.university === state.scope);
    return filterByTimeWindow(base, state.timeWindow) as TaxPerson[];
  }, [data, wheelCountry, state.scope, state.timeWindow]);

  const rings = useMemo(() => computeRings(size.width, size.height), [size.width, size.height]);

  const layout = useMemo(() => {
    if (!data) return null;
    return buildSunLayout(data.taxonomy, scopedPeople);
  }, [data, scopedPeople]);

  const byPath = useMemo(() => (layout ? buildPathIndex(layout.root) : null), [layout]);

  const sizeScale = useMemo(() => {
    const domainMax = max(scopedPeople, (p) => p.quantum_h_index ?? p.h_index ?? 0) ?? 1;
    const scale = scaleSqrt()
      .domain([0, domainMax || 1])
      .range([3.2, 26]);
    return (v: number) => scale(v);
  }, [scopedPeople]);

  // One pass per person: their anchor node (deepest occupied taxonomy arc)
  // plus jittered position. `dots` (roster ordering + pin-zoom target) and
  // `anchorOf` (the paper-mosaic's per-person angle/ancestor-chain lookup,
  // see lib/mosaic.ts) both derive from this so the anchorNodeFor/anchorFor
  // walk only happens once per person per render.
  const anchors = useMemo(() => {
    const list: { person: TaxPerson; entry: AnchorEntry; x: number; y: number; r: number }[] = [];
    if (!layout || !byPath) return list;
    scopedPeople.forEach((p) => {
      const nd = anchorNodeFor(p, byPath, layout.root);
      if (!nd) return;
      const { x, y, r, a } = anchorFor(p, nd, rings, sizeScale);
      list.push({ person: p, entry: { a, ancestorSet: new Set(nd.ancestors()) }, x, y, r });
    });
    return list;
  }, [layout, byPath, scopedPeople, rings, sizeScale]);

  const dots = useMemo<Dot[]>(
    () => anchors.map((e) => ({ person: e.person, x: e.x, y: e.y, r: e.r, color: taxColour(e.person) })),
    [anchors],
  );

  const anchorOf = useMemo(() => new Map(anchors.map((e) => [e.person.id, e.entry])), [anchors]);

  // Country wheel only: each university's wheel-wide {people, papers}, over
  // ALL of scopedPeople (not per-arc) — feeds uniAggregateEntries' "here of
  // total" hover-card math.
  const uniTotals = useMemo(() => {
    const m = new Map<string, { people: number; papers: number }>();
    if (!isCountryWheel) return m;
    scopedPeople.forEach((p) => {
      const uni = p.university || p.institution || "Unknown";
      const g = m.get(uni) ?? { people: 0, papers: 0 };
      g.people += 1;
      // Summed per-person quantum_papers double-counts any paper coauthored
      // by two people at the same university — overridden below with the
      // real distinct count when paper_counts_geo.json has one.
      g.papers += +(p.quantum_papers || 0);
      m.set(uni, g);
    });
    if (paperCounts?.by_institution) {
      m.forEach((g, uni) => {
        const distinct = paperCounts.by_institution[uni];
        if (distinct != null) g.papers = distinct;
      });
    }
    return m;
  }, [isCountryWheel, scopedPeople, paperCounts]);

  // The full paper-mosaic tile set (+ island boundary outlines) for every
  // occupied arc. Memoized on layout/scope inputs only — NOT on hover state
  // — so a hover-only re-render never recomputes the treemap/tile geometry,
  // just which already-built tiles paint dimmed/highlighted below.
  const mosaic = useMemo(() => {
    if (!layout) return { islands: [], tiles: [] };
    return buildMosaic(layout.arcs, scopedPeople, anchorOf, rings, isCountryWheel, uniTotals);
  }, [layout, scopedPeople, anchorOf, rings, isCountryWheel, uniTotals]);

  const dotById = useMemo(() => new Map(dots.map((d) => [d.person.id, d])), [dots]);
  const peopleById = useMemo(() => new Map(scopedPeople.map((p) => [p.id, p])), [scopedPeople]);

  const highlightedId = state.pinnedPersonId ?? lockedRosterId ?? hoveredId;

  const pinnedPerson = state.pinnedPersonId ? (peopleById.get(state.pinnedPersonId) ?? null) : null;
  // Roster hover/lock deliberately does NOT feed the tooltip (see
  // hoveredMosaicId's doc above) — only a pin or an actual mosaic hover does.
  const hoveredPerson = !pinnedPerson && hoveredMosaicId ? (peopleById.get(hoveredMosaicId) ?? null) : null;
  const displayedPerson = pinnedPerson ?? hoveredPerson ?? null;

  // A hovered "uni::"-prefixed tile (country wheel only) never collides with
  // pinnedPersonId/lockedRosterId, which are always real person ids — so
  // this is naturally mutually exclusive with displayedPerson above. Reads
  // `hoveredOwner` (captured at the exact hovered tile, see its state doc)
  // rather than looking the id back up in `mosaic.tiles`, since a
  // university can own tiles across many arcs with different local counts —
  // the id alone doesn't say which one is under the cursor.
  const displayedUni = useMemo(() => {
    if (!highlightedId || !highlightedId.startsWith("uni::")) return null;
    if (hoveredOwner && isUniOwner(hoveredOwner) && hoveredOwner.id === highlightedId) return hoveredOwner;
    return null;
  }, [highlightedId, hoveredOwner]);

  // Every island belonging to the currently highlighted owner (a person can
  // anchor into up to 3 — one per ring depth — and a university can span
  // many arcs), so its boundary gets a "hot" stroke wherever it appears.
  const hotIslands = useMemo(() => {
    if (!highlightedId) return [];
    return mosaic.islands.filter((isl) => isl.ownerId === highlightedId);
  }, [highlightedId, mosaic.islands]);

  // Hovering a person's mosaic tile scrolls their roster entry into view —
  // hoveredMosaicId only fires from mosaic hover (never roster hover/lock,
  // see its state doc above), so this never fights the user's own scrolling
  // of the roster.
  useEffect(() => {
    if (!hoveredMosaicId) return;
    rowRefs.current.get(hoveredMosaicId)?.scrollIntoView({ block: "nearest" });
  }, [hoveredMosaicId]);

  function unpin() {
    dispatch({ type: "SET_PINNED", id: null });
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
    }
  }

  function pinAndZoom(p: TaxPerson) {
    dispatch({ type: "SET_PINNED", id: p.id });
    const dot = dotById.get(p.id);
    if (!dot || !svgRef.current || !zoomRef.current) return;
    const cx = rings.cx + dot.x;
    const cy = rings.cy + dot.y;
    const k = 2.4;
    const tx = size.width / 2 - cx * k;
    const ty = size.height / 2 - cy * k;
    select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  const rosterRows = useMemo<RosterRow[]>(() => {
    if (isCountryWheel) {
      return [...uniTotals.keys()].map((uni) => ({
        id: uni,
        label: uni,
        sub: fmtInt(uniTotals.get(uni)?.papers ?? 0),
        isUniversity: true,
      }));
    }
    return dots
      .slice()
      .sort((a, b) => (b.person.quantum_papers ?? 0) - (a.person.quantum_papers ?? 0))
      .map((d) => ({
        id: d.person.id,
        label: d.person.name,
        sub: fmtInt(d.person.quantum_papers),
        isUniversity: false,
      }));
  }, [isCountryWheel, uniTotals, dots]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rosterRows;
    return rosterRows.filter((r) => r.label.toLowerCase().includes(q));
  }, [rosterRows, query]);

  return (
    <div className="tax-view" ref={containerRef}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="tax-svg"
        onClick={() => {
          if (state.pinnedPersonId) unpin();
        }}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {layout && (
            <g transform={`translate(${rings.cx},${rings.cy})`}>
              <g className="tax-arcs">
                {layout.arcs.map((n) => (
                  <path key={taxNodePath(n)} d={arcPathFor(n, rings) ?? undefined} fill={arcFill(n)} />
                ))}
              </g>

              <g className="tax-tiles">
                {mosaic.tiles.map((t) => {
                  const dim = highlightedId != null && highlightedId !== t.ownerId;
                  return (
                    <path
                      key={t.id}
                      d={t.d}
                      fill={t.fill}
                      className={"tax-mosaic-tile" + (dim ? " dim" : "")}
                      onMouseEnter={(e) => {
                        setHoveredId(t.ownerId);
                        setHoveredMosaicId(t.ownerId);
                        setHoveredOwner(t.owner);
                        setHoverScreen({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => setHoverScreen({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => {
                        setHoveredId(null);
                        setHoveredMosaicId(null);
                        setHoveredOwner(null);
                        setHoverScreen(null);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isUniOwner(t.owner)) {
                          dispatch({ type: "SET_SCOPE", scope: t.owner.university });
                        } else {
                          pinAndZoom(t.owner);
                        }
                      }}
                    />
                  );
                })}
              </g>

              <g className="tax-islands">
                {hotIslands.map((isl) => (
                  <path key={isl.id} d={isl.d} className="tax-island-outline hot" />
                ))}
              </g>

              <g className="tax-labels">
                {layout.arcs.map((n) => {
                  const geom = curvedLabelGeom(n, rings);
                  if (!geom) return null;
                  // font size + truncation are resolved from the LIVE zoom
                  // level every render (not memoized with the geometry) —
                  // as you zoom in past the cap the local size shrinks to
                  // hold a stable on-screen size, which frees up room to
                  // un-truncate the name instead of just growing the "…".
                  const fitted = fitLabelText(geom, transform.k);
                  const band = sectorBandPath(n, rings);
                  const pathId = labelPathId(taxNodePath(n));
                  return (
                    <g key={taxNodePath(n)}>
                      {band && <path className="tax-sector-band" d={band} />}
                      <path id={pathId} d={geom.pathD} className="tax-arc-label-path" />
                      <text className={"tax-curved-label depth-" + n.depth} fontSize={fitted.fontSize}>
                        <textPath href={"#" + pathId} startOffset="50%" textAnchor="middle">
                          {fitted.text}
                        </textPath>
                      </text>
                    </g>
                  );
                })}
              </g>

              <circle className="tax-center-hole" r={rings.ringIn[1]} />
            </g>
          )}
        </g>
      </svg>

      {loading && (
        <div className="tax-status glass-panel">
          <div className="tax-status-message">Loading discipline taxonomy…</div>
        </div>
      )}

      {error && (
        <div className="tax-status glass-panel">
          <div className="tax-status-message error">Failed to load taxonomy: {error}</div>
        </div>
      )}

      {data && !loading && !error && (
        <div className="tax-roster glass-panel">
          <div className="tax-roster-head">
            <span>{isCountryWheel ? "Universities" : "Researchers"}</span>
            <span className="tax-roster-head-sub">papers</span>
          </div>
          <input
            type="text"
            className="tax-roster-search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="tax-roster-list">
            {filteredRows.map((row) => {
              const active = row.isUniversity ? highlightedId === "uni::" + row.id : highlightedId === row.id;
              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.id, el);
                    else rowRefs.current.delete(row.id);
                  }}
                  className={"tax-roster-row" + (active ? " active" : "")}
                  onMouseEnter={(e) => {
                    if (row.isUniversity) return;
                    setHoveredId(row.id);
                    setHoverScreen({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    if (row.isUniversity) return;
                    setHoveredId(null);
                  }}
                  onClick={(e) => {
                    if (row.isUniversity) {
                      dispatch({ type: "SET_SCOPE", scope: row.id });
                      return;
                    }
                    setHoverScreen({ x: e.clientX, y: e.clientY });
                    setLockedRosterId(lockedRosterId === row.id ? null : row.id);
                  }}
                >
                  <span className="label">{row.label}</span>
                  <span className="sub">{row.sub}</span>
                </div>
              );
            })}
            {filteredRows.length === 0 && <div className="tax-roster-empty">No matches</div>}
          </div>
        </div>
      )}

      {displayedPerson &&
        (pinnedPerson ? (
          <Tooltip
            person={pinnedPerson}
            x={size.width / 2}
            y={size.height / 2 - 100}
            pinned
            onClose={unpin}
            patentLinks={patentLinks}
            collaborations={collaborations}
            knownPersonIds={knownPersonIds}
          />
        ) : (
          hoverScreen && (
            <Tooltip
              person={displayedPerson}
              x={hoverScreen.x}
              y={hoverScreen.y}
              pinned={false}
              patentLinks={patentLinks}
              collaborations={collaborations}
              knownPersonIds={knownPersonIds}
            />
          )
        ))}

      {!displayedPerson && displayedUni && hoverScreen && (
        <UniversityCard
          name={displayedUni.name}
          arcName={displayedUni.arcName}
          people={displayedUni.people}
          totalPeople={displayedUni.totalPeople}
          papers={displayedUni.quantum_papers}
          totalPapers={displayedUni.totalPapers}
          x={hoverScreen.x}
          y={hoverScreen.y}
        />
      )}
    </div>
  );
}
