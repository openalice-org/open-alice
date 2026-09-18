import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAppState } from "../../state/AppState";
import type { AggMode, GeoSizeMetric, MapMode, Person } from "../../types";
import { isGeoScope, universityCountryMap } from "../../lib/institutions";
import { taxScopeAllowed } from "../../lib/taxonomy";
import "./Rail.css";

// The unified view picker — every way of looking at the data, in one menu.
const VIEWS: { key: MapMode; label: string; icon: string; badge: string }[] = [
  { key: "taxonomy", label: "Disciplines", icon: "ph-tree-structure", badge: "44 unis" },
  { key: "domains", label: "Domains", icon: "ph-triangle", badge: "" },
  { key: "cartesian", label: "Axes", icon: "ph-crosshair", badge: "" },
  { key: "geo", label: "Geo", icon: "ph-map-trifold", badge: "" },
  { key: "list", label: "List", icon: "ph-list", badge: "" },
];

function viewAllowed(key: MapMode, scope: string): boolean {
  if (key === "taxonomy") return taxScopeAllowed(scope);
  return true; // domains, cartesian, geo, list all work at any scope
}

// Emphasis: how a point's radius is weighted. Meaningless once Boxplot is
// on screen (aggregate box glyphs, no individual points to size), so it
// locks alongside that. Patent activity dropped from here — it's its own
// dedicated Axes/Domains config option instead (a satellite-node force
// view reads better than a mere size bump).
const EMPHASIS: { key: "quantum_h_index" | "constant"; label: string }[] = [
  { key: "quantum_h_index", label: "Corpus influence" },
  { key: "constant", label: "Equal weight" },
];

// Domains' own config: which of the three domain lenses is on screen. Each
// maps onto the shared aggMode slot; "none" is the plain per-point view.
// Domain mix / Primary domain / Patents only read at a single university —
// too many people to make sense of at Nordics/country scope, so Density is
// the only one still enabled there (see aggForScope in AppState for the
// matching auto-fallback when scope widens out from under one of them).
// Patents reuses Domain mix's own ternary positions as its anchors, hides
// everyone without a patent, and orbits satellite nodes around each holder
// (see ScatterView's patentsActive).
const DOMAIN_CONFIG: { key: AggMode; label: string }[] = [
  { key: "hexdensity", label: "Density" },
  { key: "none", label: "Domain mix" },
  { key: "clusters", label: "Primary domain" },
  { key: "patents", label: "Patents" },
  { key: "universities", label: "Universities" },
];

function domainConfigAllowed(key: AggMode, scope: string): boolean {
  // Universities is the opposite of the per-person modes below: it's only
  // meaningful once there's more than one university on screen (Nordics/
  // country scope) — at a single-university scope it'd collapse to one
  // bubble containing everyone.
  if (key === "universities") return isGeoScope(scope);
  if (key === "none" || key === "clusters" || key === "patents") return !isGeoScope(scope);
  return true;
}

// Axes' own config: People (raw per-point) only reads at a single
// university, same story as Domain mix above — Boxes (boxplot) is the only
// one that still works at Nordics/country scope.
const CARTESIAN_CONFIG: { key: AggMode; label: string }[] = [
  { key: "none", label: "People" },
  { key: "boxplot", label: "Boxes" },
  { key: "patents", label: "Patents" },
  { key: "universities", label: "Universities" },
];

function cartesianConfigAllowed(key: AggMode, scope: string): boolean {
  // Universities is only meaningful at broad (Nordics/country) scope — the
  // opposite gate from the per-person "People"/"Patents" options below.
  if (key === "universities") return isGeoScope(scope);
  if (key === "none" || key === "patents") return !isGeoScope(scope);
  return true;
}

// Shown on a disabled config option's "?" badge — the native title tooltip
// alone has too long a hover delay to feel responsive in this pill.
const SCOPE_LOCK_HINT = "Only available at a single university — pick one first";

// Shown on the Emphasis buttons when they're locked (outside Axes/Domains,
// or while Boxplot's aggregate glyphs are on screen).
const EMPHASIS_LOCK_HINT = "Only applies to the Axes and Domains views";
const BROAD_SCOPE_LOCK_HINT = "Only available at Nordics/country scope — zoom out first";
function lockHintFor(key: AggMode): string {
  return key === "universities" ? BROAD_SCOPE_LOCK_HINT : SCOPE_LOCK_HINT;
}

// Geo's own config: which magnitude sizes a node's resting circle. All three
// are always available — unlike Domains/Axes, Geo's node set (countries or
// universities) doesn't change shape with scope, so there's no equivalent
// "pick a university first" restriction.
const GEO_CONFIG: { key: GeoSizeMetric; label: string }[] = [
  { key: "papers", label: "Papers" },
  { key: "people", label: "Authors" },
  { key: "citations", label: "Citations" },
];

interface PopoutProps {
  anchorRef: RefObject<HTMLElement | null>;
  side: "right" | "left"; // which side of the anchor row this sits on
  align: "top" | "center"; // top-aligned (dropdown menus) or centered (the config pill)
  className: string;
  children: ReactNode;
}

// Portaled to document.body, positioned via the anchor row's own measured
// rect — NOT a plain CSS-relative dropdown. Both rail panels have their own
// backdrop-filter (the frosted rail capsule itself), and a descendant with
// its OWN backdrop-filter nested inside that ends up sampling the wrong
// backdrop root (its blurred, boxed-in ancestor) instead of the real page
// content behind it — it renders as a flat translucent tint with crisp,
// unblurred content showing through, instead of an actual blur. Portaling
// out from under that ancestor is what lets this element's own blur work.
function Popout({ anchorRef, side, align, className, children }: PopoutProps) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      ...(side === "right" ? { left: r.right + 12 } : { right: window.innerWidth - r.left + 12 }),
      ...(align === "top" ? { top: r.top } : { top: r.top + r.height / 2, transform: "translateY(-50%)" }),
    });
  }, [anchorRef, side, align]);

  if (!style) return null;
  return createPortal(
    <div className={className} style={style} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

interface RailProps {
  people: Person[];
}

export default function Rail({ people }: RailProps) {
  const { state, dispatch } = useAppState();
  const [openMenu, setOpenMenu] = useState<"view" | "config" | null>("config");
  const uniCountry = useMemo(() => universityCountryMap(people), [people]);

  // Geo has no per-university zoom of its own — landing on it from a
  // university scope has to resolve down to that university's own country
  // (not always the whole Nordics map), while Nordics/country scopes are
  // already valid Geo scopes and stay put.
  function geoTargetScope(): string | undefined {
    if (isGeoScope(state.scope)) return undefined;
    const cc = uniCountry.get(state.scope);
    return cc ? "country:" + cc : undefined;
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRowRef = useRef<HTMLDivElement>(null);
  const configRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick() {
      setOpenMenu(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Emphasis acts on the scatter (Axes/Domains) views only — there's
  // nothing to weight on the geo map, the Disciplines wheel, or the List
  // table. Config also covers Geo now (its own size-by metric), so it has a
  // wider unlock than Emphasis.
  const onScatterView = state.mapMode === "cartesian" || state.mapMode === "domains";
  const scatterLocked = !onScatterView;
  const emphasisLocked = scatterLocked || state.aggMode === "boxplot";
  const configLocked = !onScatterView && state.mapMode !== "geo";

  const viewLabel = VIEWS.find((v) => v.key === state.mapMode)?.label ?? "";

  return (
    <>
      <div className="rail-left-stack">
      <div className="panel panel-rail rail-left glass-panel" ref={rootRef}>
        <div className="rail-row lens" title="View" ref={viewRowRef}>
          <span className="mode">{viewLabel}</span>
          <div
            className="rail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === "view" ? null : "view");
            }}
          >
            <i className="ph-light ph-eyeglasses" />
          </div>
          {openMenu === "view" && (
            <Popout anchorRef={viewRowRef} side="right" align="top" className="menu">
              <div className="menu-head">Views</div>
              {VIEWS.map((v) => {
                const allowed = viewAllowed(v.key, state.scope);
                return (
                  <div
                    key={v.key}
                    className={"menu-opt" + (v.key === state.mapMode ? " active" : "") + (allowed ? "" : " disabled")}
                    onClick={() => {
                      if (!allowed) return;
                      dispatch({ type: "SET_MAP", mode: v.key, scope: v.key === "geo" ? geoTargetScope() : undefined });
                      setOpenMenu(null);
                    }}
                  >
                    <i className={"ph-light " + v.icon} /> {v.label}
                    {!allowed && v.badge && <span className="opt-badge">{v.badge}</span>}
                  </div>
                );
              })}
            </Popout>
          )}
        </div>

      </div>
      </div>

      <div className="panel panel-rail rail-right glass-panel">
        <div className={"rail-row config" + (configLocked ? " locked" : "")} title="Config" ref={configRowRef}>
          {openMenu === "config" && !configLocked && (
            <Popout anchorRef={configRowRef} side="left" align="center" className="config-buttons">
              <span className="config-label">Emphasis</span>
              {EMPHASIS.map((l) => (
                <span key={l.key} className={"config-hint" + (emphasisLocked ? " locked" : "")}>
                  <button
                    type="button"
                    disabled={emphasisLocked}
                    title={emphasisLocked ? EMPHASIS_LOCK_HINT : undefined}
                    className={"config-btn" + (l.key === state.glassesMode ? " active" : "") + (emphasisLocked ? " disabled" : "")}
                    onClick={() => !emphasisLocked && dispatch({ type: "SET_GLASSES", mode: l.key })}
                  >
                    {l.label}
                  </button>
                </span>
              ))}

              {state.mapMode === "domains" && (
                <>
                  <span className="config-sep">|</span>
                  {DOMAIN_CONFIG.map((o) => {
                    const allowed = domainConfigAllowed(o.key, state.scope);
                    return (
                      <span key={o.key} className={"config-hint" + (allowed ? "" : " locked")}>
                        <button
                          type="button"
                          disabled={!allowed}
                          title={allowed ? undefined : lockHintFor(o.key)}
                          className={"config-btn" + (o.key === state.aggMode ? " active" : "") + (allowed ? "" : " disabled")}
                          onClick={() => allowed && dispatch({ type: "SET_AGG", mode: o.key })}
                        >
                          {o.label}
                        </button>
                        {!allowed && <i className="ph-light ph-question config-hint-icon" data-tip={lockHintFor(o.key)} />}
                      </span>
                    );
                  })}
                </>
              )}

              {state.mapMode === "cartesian" && (
                <>
                  <span className="config-sep">|</span>
                  {CARTESIAN_CONFIG.map((o) => {
                    const allowed = cartesianConfigAllowed(o.key, state.scope);
                    return (
                      <span key={o.key} className={"config-hint" + (allowed ? "" : " locked")}>
                        <button
                          type="button"
                          disabled={!allowed}
                          title={allowed ? undefined : lockHintFor(o.key)}
                          className={"config-btn" + (o.key === state.aggMode ? " active" : "") + (allowed ? "" : " disabled")}
                          onClick={() => allowed && dispatch({ type: "SET_AGG", mode: o.key })}
                        >
                          {o.label}
                        </button>
                        {!allowed && <i className="ph-light ph-question config-hint-icon" data-tip={lockHintFor(o.key)} />}
                      </span>
                    );
                  })}
                  {state.aggMode === "boxplot" && (
                    <>
                      <span className="config-sep">|</span>
                      <button
                        type="button"
                        className={"config-btn" + (state.boxOrient === "v" ? " active" : "")}
                        title="Bin along X"
                        onClick={() => dispatch({ type: "SET_BOX_ORIENT", orient: "v" })}
                      >
                        X
                      </button>
                      <button
                        type="button"
                        className={"config-btn" + (state.boxOrient === "h" ? " active" : "")}
                        title="Bin along Y"
                        onClick={() => dispatch({ type: "SET_BOX_ORIENT", orient: "h" })}
                      >
                        Y
                      </button>
                    </>
                  )}
                </>
              )}

              {state.mapMode === "geo" && (
                <>
                  <span className="config-sep">|</span>
                  <span className="config-label">Size by</span>
                  {GEO_CONFIG.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className={"config-btn" + (o.key === state.geoSizeMetric ? " active" : "")}
                      onClick={() => dispatch({ type: "SET_GEO_SIZE_METRIC", metric: o.key })}
                    >
                      {o.label}
                    </button>
                  ))}
                </>
              )}
            </Popout>
          )}
          <div
            className="rail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === "config" ? null : "config");
            }}
          >
            <i className="ph-light ph-gear" />
          </div>
        </div>
      </div>
    </>
  );
}
