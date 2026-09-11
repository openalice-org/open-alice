import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath as d3GeoPath, geoCentroid } from "d3-geo";
import { scaleSqrt, scalePow } from "d3-scale";
import { mean, sum } from "d3-array";
import { pie as d3Pie, arc as d3Arc } from "d3-shape";
import { useAppState } from "../../state/AppState";
import type { DomainShares, GeoSizeMetric, Person, PaperCounts } from "../../types";
import { COUNTRY_LABELS, COUNTRY_ORDER, labelForScope, universityCountryMap } from "../../lib/institutions";
import { UNI_GEO } from "../../lib/uniGeo";
import { CITY_COUNTRY, CITY_FAN, CITY_UNIS } from "../../lib/cityGeo";
import { DOMAIN_LABELS, DOMAIN_ORDER, DOMAIN_SHADES, aggregateGeo, type GeoAggregate } from "../../lib/geoAggregate";
import { dominantDomainOf, DOMAIN_COLORS_VIVID } from "../../lib/ternary";
import nordicsGeoRaw from "../../data/nordicsGeo.json";
import { fmtInt } from "../../lib/format";
import "./GeoView.css";

// Reading order for the aid panel's per-domain sections — independent of
// DOMAIN_ORDER above (which only fixes the pie slices' internal order).
const PANEL_DOMAIN_ORDER: (keyof DomainShares)[] = ["sensing", "communication", "computing"];

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Real Nordic country outlines (Natural Earth 1:50m, simplified), ported
// verbatim from SPRINT 13's NORDICS_GEO. One GeoJSON Polygon/MultiPolygon per
// country code.
type GeoGeometry = { type: string; coordinates: unknown };
const NORDICS_GEO = nordicsGeoRaw as Record<string, GeoGeometry>;

const VIEW_W = 1000;
const VIEW_H = 700;
const MARGIN_X = 90;
const MARGIN_Y = 60;

const pie = d3Pie<number>().sort(null);

interface GeoViewProps {
  people: Person[];
  paperCounts: PaperCounts | null;
}

interface HoverCard {
  x: number;
  y: number;
  title: string;
  agg: GeoAggregate;
}

interface UniNode {
  name: string;
  agg: GeoAggregate;
  r: number;
  tx: number;
  ty: number;
}

interface CityGroup {
  city: string;
  x: number;
  y: number;
  r: number;
  members: UniNode[];
}

// Near-white "faded out" fill for a pie slice's non-hovered siblings in the
// aid panel — close to --paper-deep so it reads as receding into the page
// rather than just dimming.
const PANEL_DIM_FILL = "#f2f1ea";

// A map university's resting glyph colour — plain grey, matching
// PieGlyph's own zero-data fallback (.geo-pie-fallback) — until a domain
// section is hovered in the aid panel, when it takes that domain's colour.
const GEO_UNI_GRAY = "#9a9a93";

/** Reads whichever magnitude the Geo config's "size by" option currently
 * picks (Papers/Authors/Citations) off a node's aggregate — the single
 * accessor every radius scale below sizes its nodes from, so switching the
 * config restyles the whole map instead of one level of it. */
function sizeMetricValue(agg: GeoAggregate, metric: GeoSizeMetric): number {
  switch (metric) {
    case "people":
      return agg.people;
    case "citations":
      return agg.citations;
    default:
      return agg.papers;
  }
}

/** One node's glyph: a domain-share pie (computing/communication/sensing),
 * or a flat grey circle when none of its members have domain shares yet.
 * Two distinct modes, switched on whether `highlight` is passed at all:
 * - `highlight` omitted (map usage): plain `colors[k]` fill always — the
 *   map's own achromatic GEO_SHADES by default (deliberately quiet, see
 *   DOMAIN_SHADES's own comment).
 * - `highlight` passed, even as null (aid-panel usage): every slice stays
 *   `colors[k]` (grayscale via DOMAIN_SHADES) at rest and when it's itself
 *   the hovered one; once a domain section is hovered, only the OTHER
 *   slices crossfade to PANEL_DIM_FILL — set via `style` (not the `fill`
 *   attribute) so the CSS transition below actually animates it instead of
 *   snapping. */
function PieGlyph({
  r,
  agg,
  highlight,
  colors = DOMAIN_SHADES,
  slicesKey = "slices",
}: {
  r: number;
  agg: GeoAggregate;
  highlight?: keyof DomainShares | null;
  colors?: Record<keyof DomainShares, string>;
  /** Which per-domain breakdown to draw from — `slices` (papers, the map's
   * own default) or `citationSlices` (aid-panel overview when Geo is sized
   * by citations). */
  slicesKey?: "slices" | "citationSlices";
}) {
  const slices = agg[slicesKey];
  const total = DOMAIN_ORDER.reduce((s, k) => s + slices[k], 0);
  if (total <= 0) return <circle r={r} className="geo-pie-fallback" />;
  const arcGen = d3Arc<{ value: number }>().innerRadius(0).outerRadius(r);
  const arcs = pie(DOMAIN_ORDER.map((k) => slices[k]));
  return (
    <>
      {arcs.map((a, i) => {
        const k = DOMAIN_ORDER[i];
        const fill = highlight != null && highlight !== k ? PANEL_DIM_FILL : colors[k];
        return (
          <path
            key={k}
            d={arcGen(a) ?? undefined}
            className={highlight !== undefined ? "pie-slice-transition" : undefined}
            style={{ fill }}
          />
        );
      })}
    </>
  );
}

/** A resting grey circle that crossfades to `PieGlyph`'s domain-mix pie when
 * `showPie` is true — both stay mounted at once (opacity-only crossfade),
 * shared between CityNode's universities and the Nordics-wide country
 * nodes below so both levels get the same hover behaviour. */
function GeoGlyph({
  r,
  displayR,
  agg,
  showPie,
  circleFill,
}: {
  r: number;
  displayR: number;
  agg: GeoAggregate;
  showPie: boolean;
  circleFill: string;
}) {
  return (
    <>
      <circle className="geo-domain-circle" r={displayR} style={{ fill: circleFill, opacity: showPie ? 0 : 1 }} />
      <g className="geo-uni-pie-fade" style={{ opacity: showPie ? 1 : 0 }}>
        <PieGlyph r={r} agg={agg} />
      </g>
    </>
  );
}

/**
 * A city node: every member university's pie sits permanently at its own
 * fanned-out spot (CITY_FAN's angle × the radial spacing computed in
 * cityNodes below, sized off each member's own radius so neighbours never
 * touch) — no hover-triggered reveal. Multi-university cities keep a small
 * anchor dot plus dotted leader lines back to it for spatial context;
 * single-university cities have nothing to fan out (tx/ty are 0) so the pie
 * just sits at the city's own point.
 */
function CityNode({
  city,
  hoveredName,
  onHoverMember,
  onLeaveMember,
  onClickMember,
  hoveredDomain,
  domainScale,
}: {
  city: CityGroup;
  // The one university currently under the mouse (drives the floating
  // tooltip up in GeoView) — that glyph alone crossfades to its domain-mix
  // pie; every other glyph stays a plain circle.
  hoveredName: string | null;
  onHoverMember: (e: React.MouseEvent, node: UniNode) => void;
  onLeaveMember: () => void;
  onClickMember: (name: string) => void;
  // While a domain section is hovered in the aid panel, every university's
  // resting circle recolours to that domain's own colour and resizes off
  // `domainScale` (that university's magnitude in just this domain) instead
  // of its usual fixed size.
  hoveredDomain: keyof DomainShares | null;
  domainScale: ((value: number) => number) | null;
}) {
  const n = city.members.length;

  return (
    <g className="geo-city" transform={`translate(${city.x},${city.y})`}>
      {n > 1 && (
        <>
          <g className="geo-leaders">
            {city.members.map((m) => (
              <line key={m.name} className="geo-leader" x1={0} y1={0} x2={m.tx} y2={m.ty} />
            ))}
          </g>
          <circle className="geo-core" r={4.5} />
        </>
      )}
      {city.members.map((m) => {
        const showPie = hoveredName === m.name;
        const displayR = hoveredDomain && domainScale ? domainScale(m.agg.slices[hoveredDomain]) : m.r;
        const circleFill = hoveredDomain ? DOMAIN_COLORS_VIVID[hoveredDomain] : GEO_UNI_GRAY;
        return (
          <g
            key={m.name}
            className="geo-uni"
            transform={`translate(${m.tx},${m.ty})`}
            onMouseEnter={(e) => onHoverMember(e, m)}
            onMouseLeave={onLeaveMember}
            onClick={(e) => {
              e.stopPropagation();
              onClickMember(m.name);
            }}
          >
            <GeoGlyph r={m.r} displayR={displayR} agg={m.agg} showPie={showPie} circleFill={circleFill} />
            {displayR > 8 && (
              <text className="inst-label" y={displayR + 12}>
                {m.name.length > 24 ? m.name.slice(0, 22) + "…" : m.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export default function GeoView({ people, paperCounts }: GeoViewProps) {
  const { state, dispatch } = useAppState();
  const [hover, setHover] = useState<HoverCard | null>(null);
  // Hovering a domain SECTION in the aid panel only — the panel's overview
  // pie never changes size and never swaps to a specific institution's own
  // mix (map hover stays fully separate, driving only its usual tooltip via
  // `hover` above); this just recolors the pie's slices in place.
  const [hoveredPanelDomain, setHoveredPanelDomain] = useState<keyof DomainShares | null>(null);
  const countryScope = state.scope.startsWith("country:") ? state.scope.slice(8) : null;

  useEffect(() => setHoveredPanelDomain(null), [countryScope]);

  const uniCountry = useMemo(() => universityCountryMap(people), [people]);

  // Real d3-geo Mercator projection, refit to whichever geometry is on
  // screen — the whole Nordics GeometryCollection, or just the drilled-into
  // country — mirroring SPRINT 13's renderGeo (it recomputes the projection
  // per level rather than panning/zooming a fixed one).
  const projection = useMemo(() => {
    const geom = countryScope
      ? NORDICS_GEO[countryScope]
      : { type: "GeometryCollection", geometries: Object.values(NORDICS_GEO) };
    return geoMercator().fitExtent(
      [
        [MARGIN_X, MARGIN_Y],
        [VIEW_W - MARGIN_X, VIEW_H - MARGIN_Y],
      ],
      geom as never,
    );
  }, [countryScope]);

  const path = useMemo(() => d3GeoPath(projection), [projection]);

  const countryNodes = useMemo(() => {
    const byCountry = new Map<string, Person[]>();
    people.forEach((p) => {
      const cc = uniCountry.get(p.university);
      if (!cc) return;
      if (!byCountry.has(cc)) byCountry.set(cc, []);
      byCountry.get(cc)!.push(p);
    });
    const withAgg = COUNTRY_ORDER.map((cc) => ({
      cc,
      agg: aggregateGeo(
        byCountry.get(cc) ?? [],
        paperCounts?.by_country?.[cc],
        paperCounts?.domain_by_country?.[cc],
        state.timeWindow,
      ),
    }));
    const maxVal = Math.max(1, ...withAgg.map((c) => sizeMetricValue(c.agg, state.geoSizeMetric)));
    // Widened output range (was [11, 30]) so the gap between small and large
    // values reads more clearly — area still scales linearly with the value
    // (scaleSqrt), just over a bigger spread.
    const r = scaleSqrt().domain([0, maxVal]).range([8, 38]);
    return withAgg.map((c) => {
      const [x, y] = projection(geoCentroid(NORDICS_GEO[c.cc] as never)) ?? [0, 0];
      return { ...c, r: Math.max(6, r(sizeMetricValue(c.agg, state.geoSizeMetric))), x, y };
    });
  }, [people, paperCounts, uniCountry, projection, state.geoSizeMetric, state.timeWindow]);

  // Universities present in the drilled-into country, rolled up by city
  // (CITY_UNIS) so a multi-university city can collapse to one node and
  // burst open on hover instead of showing overlapping same-city pies.
  const cityNodes = useMemo(() => {
    if (!countryScope) return [];
    const byUni = new Map<string, Person[]>();
    people.forEach((p) => {
      if (uniCountry.get(p.university) !== countryScope) return;
      if (!UNI_GEO[p.university]) return;
      if (!byUni.has(p.university)) byUni.set(p.university, []);
      byUni.get(p.university)!.push(p);
    });
    const uniAgg = new Map<string, GeoAggregate>();
    byUni.forEach((members, name) => {
      uniAgg.set(
        name,
        aggregateGeo(members, paperCounts?.by_institution?.[name], paperCounts?.domain_by_institution?.[name], state.timeWindow),
      );
    });
    if (!uniAgg.size) return [];

    const maxUniVal = Math.max(1, ...[...uniAgg.values()].map((a) => sizeMetricValue(a, state.geoSizeMetric)));
    // Widened (was [6, 20]) for the same increased-contrast reason as
    // countryNodes' scale above.
    const rUni = scaleSqrt().domain([0, maxUniVal]).range([4, 26]);

    const raw = Object.entries(CITY_UNIS)
      .filter(([city]) => CITY_COUNTRY[city] === countryScope)
      .map(([city, unis]) => {
        const members = unis.filter((u) => uniAgg.has(u));
        if (!members.length) return null;
        const pts = unis.map((u) => projection(UNI_GEO[u]) ?? [0, 0]);
        const x = mean(pts, (p) => p[0]) ?? 0;
        const y = mean(pts, (p) => p[1]) ?? 0;
        const cityVal = sum(members, (u) => sizeMetricValue(uniAgg.get(u)!, state.geoSizeMetric));
        return { city, x, y, members, cityVal };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

    const maxCityVal = Math.max(1, ...raw.map((g) => g.cityVal));
    // Widened (was [10, 26]) for the same increased-contrast reason above.
    const rCity = scaleSqrt().domain([0, maxCityVal]).range([8, 32]);

    return raw.map((g): CityGroup => {
      const n = g.members.length;
      const cr = Math.max(6, rCity(g.cityVal));
      const memberR = g.members.map((u) => Math.max(3, rUni(sizeMetricValue(uniAgg.get(u)!, state.geoSizeMetric))));
      const maxMR = Math.max(...memberR);
      const expandR = n > 1 ? cr + 40 + maxMR : 0;
      const fan = CITY_FAN[g.city] ?? { center: 0, spread: 2.0 };
      const members: UniNode[] = g.members.map((name, i) => {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0;
        const angle = fan.center + t * fan.spread;
        return {
          name,
          agg: uniAgg.get(name)!,
          r: memberR[i],
          tx: n > 1 ? Math.cos(angle) * expandR : 0,
          ty: n > 1 ? Math.sin(angle) * expandR : 0,
        };
      });
      return { city: g.city, x: g.x, y: g.y, r: cr, members };
    });
  }, [people, countryScope, uniCountry, paperCounts, projection, state.geoSizeMetric, state.timeWindow]);

  // While a domain section is hovered in the aid panel, every map node's
  // circle resizes off ITS OWN magnitude in just that domain (not its usual
  // overall size) — scaled against the biggest domain value among whichever
  // level is actually plotted (universities when drilled into a country,
  // countries at the Nordics-wide view). The domain max is taken across ALL
  // THREE domains, not just the hovered one: whichever unit is biggest
  // overall (e.g. Sweden) would otherwise get renormalized to the range
  // ceiling on every hover, pinning it to the same visual size no matter
  // which domain is picked and hiding that its computing/communication/
  // sensing totals actually differ.
  const hoverDomainMax = useMemo(() => {
    const nodeAggs = countryScope ? cityNodes.flatMap((c) => c.members.map((m) => m.agg)) : countryNodes.map((c) => c.agg);
    const values = nodeAggs.flatMap((agg) => DOMAIN_ORDER.map((k) => agg.slices[k]));
    return Math.max(1, ...values);
  }, [cityNodes, countryNodes, countryScope]);

  const hoverDomainScale = useMemo(() => {
    if (!hoveredPanelDomain) return null;
    // Close to the resting size ranges (country/uni [8,38]/[4,26]) so the
    // hover swap doesn't blow past the map's own scale, but exponent 0.18
    // (well below scaleSqrt's 0.5) still heavily exaggerates the small/large
    // gap beyond true area-proportionality — deliberately "unfair" so the
    // swap reads as an obvious size change without ballooning past the map.
    const range: [number, number] = countryScope ? [2, 26] : [4, 36];
    return scalePow().exponent(0.18).domain([0, hoverDomainMax]).range(range);
  }, [hoveredPanelDomain, hoverDomainMax, countryScope]);

  // Aid panel data — same shape at both levels: an overview aggregate, a
  // {name, agg} row per unit for the top-3-by-domain lists, and each
  // domain's primary-domain people count. Drilled into a country, the units
  // are its institutions; at the Nordics-wide view, the units are countries
  // and the overview aggregate sums across all of them (paper total from
  // paperCounts when available, since no precomputed Nordics-wide distinct
  // domain breakdown exists — summing each country's own is the same
  // fallback the app already uses when a distinct count is missing).
  const countryAgg = useMemo(() => countryNodes.find((c) => c.cc === countryScope)?.agg ?? null, [countryNodes, countryScope]);

  const nordicsAgg = useMemo(
    (): GeoAggregate => ({
      people: sum(countryNodes, (c) => c.agg.people),
      papers: paperCounts?.total ?? sum(countryNodes, (c) => c.agg.papers),
      papersDistinct: paperCounts != null,
      citations: sum(countryNodes, (c) => c.agg.citations),
      citationsWindowed: countryNodes.some((c) => c.agg.citationsWindowed),
      slices: {
        computing: sum(countryNodes, (c) => c.agg.slices.computing),
        communication: sum(countryNodes, (c) => c.agg.slices.communication),
        sensing: sum(countryNodes, (c) => c.agg.slices.sensing),
      },
      citationSlices: {
        computing: sum(countryNodes, (c) => c.agg.citationSlices.computing),
        communication: sum(countryNodes, (c) => c.agg.citationSlices.communication),
        sensing: sum(countryNodes, (c) => c.agg.citationSlices.sensing),
      },
    }),
    [countryNodes, paperCounts],
  );

  const panelAgg = countryScope ? countryAgg : nordicsAgg;

  const countryUniAgg = useMemo(() => {
    if (!countryScope) return [] as { name: string; agg: GeoAggregate }[];
    const byUni = new Map<string, Person[]>();
    people.forEach((p) => {
      if (uniCountry.get(p.university) !== countryScope) return;
      if (!byUni.has(p.university)) byUni.set(p.university, []);
      byUni.get(p.university)!.push(p);
    });
    return [...byUni.entries()].map(([name, members]) => ({
      name,
      agg: aggregateGeo(members, paperCounts?.by_institution?.[name], paperCounts?.domain_by_institution?.[name], state.timeWindow),
    }));
  }, [people, countryScope, uniCountry, paperCounts, state.timeWindow]);

  const panelRows = useMemo(() => {
    if (countryScope) return countryUniAgg;
    return countryNodes.map((c) => ({ name: COUNTRY_LABELS[c.cc] ?? c.cc, agg: c.agg }));
  }, [countryScope, countryUniAgg, countryNodes]);

  // Whichever count reads as the map's own headline number right now — when
  // Geo is sized by citations, the aid panel/hover card switch to citations
  // too (both the head total and the per-domain breakdown below) so the
  // displayed figures match what's actually driving node size.
  const sizeByCitations = state.geoSizeMetric === "citations";

  const panelDomainTop3 = useMemo(() => {
    const result = {} as Record<keyof DomainShares, { name: string; value: number }[]>;
    PANEL_DOMAIN_ORDER.forEach((k) => {
      result[k] = panelRows
        .map((u) => ({ name: u.name, value: sizeByCitations ? u.agg.citationSlices[k] : u.agg.slices[k] }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
    });
    return result;
  }, [panelRows, sizeByCitations]);

  const panelDomainPeople = useMemo(() => {
    const counts = { computing: 0, communication: 0, sensing: 0 } as Record<keyof DomainShares, number>;
    people.forEach((p) => {
      if (countryScope && uniCountry.get(p.university) !== countryScope) return;
      const dom = dominantDomainOf(p);
      if (dom) counts[dom]++;
    });
    return counts;
  }, [people, countryScope, uniCountry]);

  // Overview pie is always fixed-size — it never resizes or swaps to a
  // single unit's own mix on hover, in the panel or on the map.
  const panelR = 44;

  return (
    <div className="geo-view">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="geo-svg">
        {!countryScope
          ? COUNTRY_ORDER.map((cc) => (
              <path key={cc} className="geo-outline" d={path(NORDICS_GEO[cc] as never) ?? undefined} />
            ))
          : <path className="geo-outline" d={path(NORDICS_GEO[countryScope] as never) ?? undefined} />}

        {!countryScope
          ? countryNodes.map((c) => {
              const label = COUNTRY_LABELS[c.cc] ?? c.cc;
              const showPie = hover?.title === label;
              const displayR = hoveredPanelDomain && hoverDomainScale ? hoverDomainScale(c.agg.slices[hoveredPanelDomain]) : c.r;
              const circleFill = hoveredPanelDomain ? DOMAIN_COLORS_VIVID[hoveredPanelDomain] : GEO_UNI_GRAY;
              return (
                <g
                  key={c.cc}
                  className="geo-node"
                  transform={`translate(${c.x},${c.y})`}
                  onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, title: label, agg: c.agg })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    // the clicked country node unmounts once cityNodes replaces
                    // countryNodes, so no mouseleave ever fires to clear this —
                    // clear it explicitly or the tooltip is stuck floating.
                    setHover(null);
                    dispatch({ type: "SET_SCOPE", scope: "country:" + c.cc });
                  }}
                >
                  <GeoGlyph r={c.r} displayR={displayR} agg={c.agg} showPie={showPie} circleFill={circleFill} />
                  <text className="country-label" y={displayR + 18}>
                    {label.toUpperCase()}
                  </text>
                </g>
              );
            })
          : cityNodes.map((city) => (
              <CityNode
                key={city.city}
                city={city}
                hoveredName={hover?.title ?? null}
                onHoverMember={(e, node) => setHover({ x: e.clientX, y: e.clientY, title: node.name, agg: node.agg })}
                onLeaveMember={() => setHover(null)}
                onClickMember={(name) => dispatch({ type: "SET_SCOPE", scope: name })}
                hoveredDomain={hoveredPanelDomain}
                domainScale={hoverDomainScale}
              />
            ))}
      </svg>

      {panelAgg && (
        <div className="geo-aid-panel glass-panel">
          <div className="aid-head">{labelForScope(state.scope)}</div>
          <div className="aid-sub">
            {fmtInt(panelAgg.people)} people ·{" "}
            {sizeByCitations ? `${fmtInt(panelAgg.citations)} citations` : `${fmtInt(panelAgg.papers)} papers`}
          </div>

          <div className="aid-overview">
            <svg width={panelR * 2 + 4} height={panelR * 2 + 4} className="aid-pie-svg">
              <g transform={`translate(${panelR + 2},${panelR + 2})`}>
                <PieGlyph
                  r={panelR}
                  agg={panelAgg}
                  highlight={hoveredPanelDomain}
                  colors={DOMAIN_SHADES}
                  slicesKey={sizeByCitations ? "citationSlices" : "slices"}
                />
              </g>
            </svg>
            <div className="aid-caption">
              <div>Grey wedges show each domain's share of the {sizeByCitations ? "citations" : "papers"} here</div>
              <div>Hover a domain below to pick it out in colour</div>
            </div>
          </div>

          <div className="aid-domains">
            {PANEL_DOMAIN_ORDER.map((k) => (
              <div
                key={k}
                className="aid-domain"
                style={hoveredPanelDomain === k ? { backgroundColor: hexToRgba(DOMAIN_COLORS_VIVID[k], 0.1) } : undefined}
                onMouseEnter={() => setHoveredPanelDomain(k)}
                onMouseLeave={() => setHoveredPanelDomain(null)}
              >
                <div className="aid-domain-head">
                  <span className="aid-domain-label">
                    <i className="aid-domain-dot" style={{ background: DOMAIN_COLORS_VIVID[k] }} />
                    {DOMAIN_LABELS[k]}
                  </span>
                  <span className="aid-domain-count">
                    {fmtInt(panelDomainPeople[k])} people ·{" "}
                    {sizeByCitations
                      ? `${fmtInt(panelAgg.citationSlices[k])} citations`
                      : `${fmtInt(panelAgg.slices[k])} papers`}
                  </span>
                </div>
                <div className="aid-domain-list">
                  {panelDomainTop3[k].map((row, i) => (
                    <div className="aid-domain-row" key={row.name}>
                      <span className="rank">{i + 1}</span>
                      <span className="name">{row.name}</span>
                      <span className="value">{fmtInt(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hover && (
        <div className="geo-hover-card glass-panel" style={{ left: hover.x + 18, top: hover.y + 18 }}>
          <div className="title">{hover.title}</div>
          <div className="row">
            <span>People</span>
            <b>{fmtInt(hover.agg.people)}</b>
          </div>
          <div className="row">
            <span>{sizeByCitations ? "Citations" : "Quantum papers"}</span>
            <b>{fmtInt(sizeByCitations ? hover.agg.citations : hover.agg.papers)}</b>
          </div>
          {DOMAIN_ORDER.map((k) => {
            const total = DOMAIN_ORDER.reduce((s, kk) => s + hover.agg.slices[kk], 0) || 1;
            return (
              <div className="row" key={k}>
                <span>
                  <i className="domain-dot" style={{ background: DOMAIN_SHADES[k] }} />
                  {DOMAIN_LABELS[k]}
                </span>
                <b>{Math.round((100 * hover.agg.slices[k]) / total)}%</b>
              </div>
            );
          })}
          <div className="geo-caveat">
            {sizeByCitations
              ? hover.agg.citationsWindowed
                ? "Citations from papers published in the selected window, summed per author — co-authored work may count more than once."
                : "Summed corpus h-index across authors — an influence proxy, not a raw citation count."
              : hover.agg.papersDistinct
                ? "Distinct papers — a co-authored work is counted once here."
                : "Papers per person — co-authored work may count more than once."}
          </div>
        </div>
      )}
    </div>
  );
}
