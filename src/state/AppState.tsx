import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { AggMode, BoxOrient, GeoSizeMetric, GlassesMode, MapMode, TimeWindow } from "../types";
import { NORDICS_SCOPE, isGeoScope } from "../lib/institutions";
import { taxScopeAllowed } from "../lib/taxonomy";
import { aggModeAllowed } from "../lib/aggMode";

export interface AppState {
  scope: string; // institution name | "country:XX" | "Nordics"
  glassesMode: GlassesMode;
  mapMode: MapMode;
  aggMode: AggMode; // positional overlay shared by the Glasses (boxplot/hexdensity) and Aggregations (clusters) lenses
  boxOrient: BoxOrient;
  geoSizeMetric: GeoSizeMetric; // Geo's own config: which magnitude sizes a node's resting circle
  timeWindow: TimeWindow; // global time-window filter: narrows people by first_year/last_year across every view
  search: string;
  searchOpen: boolean;
  pinnedPersonId: string | null;
}

// The cog popout's mode-specific display config (glassesMode/aggMode/
// boxOrient/geoSizeMetric) is remembered per mapMode in localStorage, so
// switching views and coming back — or reloading the page — restores
// whatever was last set for that view. Deliberately NOT persisted: scope,
// search, pinned person, or which rail menu is open.
interface ViewConfig {
  glassesMode: GlassesMode;
  aggMode: AggMode;
  boxOrient: BoxOrient;
  geoSizeMetric: GeoSizeMetric;
}

type ConfigByMode = Partial<Record<MapMode, ViewConfig>>;

const VIEW_CONFIG_STORAGE_KEY = "openalice.viewConfig";

// Whitelists for the four persisted enum fields — a stale/corrupted
// localStorage entry (e.g. from a renamed enum value in a future build)
// should be dropped rather than flowing straight into state unchecked.
const VALID_GLASSES_MODES: readonly GlassesMode[] = ["constant", "quantum_h_index", "global_h_index"];
const VALID_AGG_MODES: readonly AggMode[] = ["none", "boxplot", "hexdensity", "clusters", "patents"];
const VALID_BOX_ORIENTS: readonly BoxOrient[] = ["h", "v"];
const VALID_GEO_SIZE_METRICS: readonly GeoSizeMetric[] = ["papers", "people", "citations"];

function sanitizeViewConfig(raw: unknown): ViewConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as Partial<Record<keyof ViewConfig, unknown>>;
  const out: Partial<ViewConfig> = {};
  if (VALID_GLASSES_MODES.includes(candidate.glassesMode as GlassesMode)) {
    out.glassesMode = candidate.glassesMode as GlassesMode;
  }
  if (VALID_AGG_MODES.includes(candidate.aggMode as AggMode)) {
    out.aggMode = candidate.aggMode as AggMode;
  }
  if (VALID_BOX_ORIENTS.includes(candidate.boxOrient as BoxOrient)) {
    out.boxOrient = candidate.boxOrient as BoxOrient;
  }
  if (VALID_GEO_SIZE_METRICS.includes(candidate.geoSizeMetric as GeoSizeMetric)) {
    out.geoSizeMetric = candidate.geoSizeMetric as GeoSizeMetric;
  }
  return out as ViewConfig;
}

function configOf(state: AppState): ViewConfig {
  return {
    glassesMode: state.glassesMode,
    aggMode: state.aggMode,
    boxOrient: state.boxOrient,
    geoSizeMetric: state.geoSizeMetric,
  };
}

function loadConfigByMode(): ConfigByMode {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(VIEW_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ConfigByMode = {};
    for (const [mode, config] of Object.entries(parsed as Record<string, unknown>)) {
      const sanitized = sanitizeViewConfig(config);
      if (sanitized) out[mode as MapMode] = sanitized;
    }
    return out;
  } catch {
    return {};
  }
}

function saveViewConfig(mode: MapMode, config: ViewConfig): void {
  if (typeof window === "undefined") return;
  try {
    const all = loadConfigByMode();
    all[mode] = config;
    window.localStorage.setItem(VIEW_CONFIG_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable/full/corrupt — persistence is best-effort only.
  }
}

function baseInitialState(): AppState {
  return {
    scope: NORDICS_SCOPE,
    glassesMode: "quantum_h_index",
    mapMode: "geo",
    aggMode: "none",
    boxOrient: "h",
    geoSizeMetric: "papers",
    timeWindow: "all",
    search: "",
    searchOpen: false,
    pinnedPersonId: null,
  };
}

function createInitialState(): AppState {
  const state = baseInitialState();
  const saved = loadConfigByMode()[state.mapMode];
  return saved ? { ...state, ...saved } : state;
}

type Action =
  | { type: "SET_SCOPE"; scope: string }
  | { type: "SET_GLASSES"; mode: GlassesMode }
  | { type: "SET_MAP"; mode: MapMode; scope?: string }
  | { type: "SET_AGG"; mode: AggMode }
  | { type: "SET_BOX_ORIENT"; orient: BoxOrient }
  | { type: "SET_GEO_SIZE_METRIC"; metric: GeoSizeMetric }
  | { type: "SET_TIME_WINDOW"; window: TimeWindow }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_SEARCH_OPEN"; open: boolean }
  | { type: "SET_PINNED"; id: string | null };

// Views are keyed off mapMode alone now (List/Geo/Disciplines/Axes/Domains
// are all lens options) — so a scope change has to carry mapMode along to
// wherever it still makes sense, the same way the old isGeoScope-overrides-
// mapMode routing did implicitly. List, Domains, and Axes are all
// scope-independent (each renders whatever's in `people` — Nordics, a
// country, or a single university — same as Geo/List) so all three are left
// alone; only Disciplines and Geo actually care which scope they land on.
function nextMapMode(mode: MapMode, scope: string): MapMode {
  if (mode === "list" || mode === "domains" || mode === "cartesian") return mode;
  const geo = isGeoScope(scope);
  if (mode === "taxonomy") return taxScopeAllowed(scope) ? mode : geo ? "geo" : "cartesian";
  return geo ? "geo" : "cartesian"; // mode was "geo": stay, or leave for a university
}

// Domain mix/Primary domain (Domains) and People (Axes) only make sense once
// scoped down to a single university — at Nordics/country scope there are
// too many people for a raw per-point view to read, so landing on a bigger
// scope while one's active falls back to the Universities aggregate instead.
function aggForScope(mapMode: MapMode, agg: AggMode, scope: string): AggMode {
  // "universities" is only meaningful at a broad (Nordics/country) scope —
  // drilling into a single university via a bubble click (or restoring it
  // from localStorage at a narrow scope) must fall back to a per-person view
  // instead of leaving one giant degenerate bubble on screen.
  if (agg === "universities" && !isGeoScope(scope)) return "none";
  if (!isGeoScope(scope)) return agg;
  if (mapMode === "domains" && (agg === "none" || agg === "clusters" || agg === "patents")) return "universities";
  if (mapMode === "cartesian" && (agg === "none" || agg === "patents")) return "universities";
  return agg;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SCOPE": {
      if (action.scope === state.scope) return state;
      const mapMode = nextMapMode(state.mapMode, action.scope);
      let aggMode = aggModeAllowed(state.aggMode, mapMode) ? state.aggMode : "none";
      aggMode = aggForScope(mapMode, aggMode, action.scope);
      return {
        ...state,
        scope: action.scope,
        mapMode,
        aggMode,
        pinnedPersonId: null,
      };
    }
    case "SET_GLASSES": {
      // Layers (radius weighting) and Config's positional overlay (aggMode)
      // are independent controls now — picking a weighting metric shouldn't
      // touch whichever Domains/Axes lens is currently active.
      if (action.mode === state.glassesMode) return state;
      const next = { ...state, glassesMode: action.mode };
      saveViewConfig(next.mapMode, configOf(next));
      return next;
    }
    case "SET_MAP": {
      // Geo is the only view not scoped to a single university — picking it
      // from a university has to pull scope out to that university's own
      // country (caller resolves and passes it via action.scope); Nordics/
      // country scopes already work as Geo scopes and are left alone. Fall
      // back to the Nordics map only if no resolved scope was given.
      const scope =
        action.mode === "geo" && !isGeoScope(state.scope) ? (action.scope ?? NORDICS_SCOPE) : state.scope;
      if (action.mode === state.mapMode && scope === state.scope) return state;
      // a projection change can strand the current overlay (e.g. leaving
      // Cartesian while Boxplot is active) — drop it rather than showing a
      // stale glyph that no longer applies to this projection
      let aggMode = aggModeAllowed(state.aggMode, action.mode) ? state.aggMode : "none";
      aggMode = aggForScope(action.mode, aggMode, scope);
      // Restore whatever display config was last used for the view being
      // switched to, so hopping between views (and back) doesn't lose
      // per-view settings. The restored aggMode must pass through the same
      // guards as the live-state value above — localStorage can hold a
      // value that's no longer valid for this mode/scope combo.
      const saved = loadConfigByMode()[action.mode];
      const restoredAgg = saved?.aggMode ?? aggMode;
      aggMode = aggForScope(action.mode, aggModeAllowed(restoredAgg, action.mode) ? restoredAgg : "none", scope);
      return {
        ...state,
        mapMode: action.mode,
        aggMode,
        glassesMode: saved?.glassesMode ?? state.glassesMode,
        boxOrient: saved?.boxOrient ?? state.boxOrient,
        geoSizeMetric: saved?.geoSizeMetric ?? state.geoSizeMetric,
        scope,
        pinnedPersonId: null,
      };
    }
    case "SET_AGG": {
      if (action.mode === state.aggMode) return state;
      const next = { ...state, aggMode: action.mode };
      saveViewConfig(next.mapMode, configOf(next));
      return next;
    }
    case "SET_BOX_ORIENT": {
      if (action.orient === state.boxOrient) return state;
      const next = { ...state, boxOrient: action.orient };
      saveViewConfig(next.mapMode, configOf(next));
      return next;
    }
    case "SET_GEO_SIZE_METRIC": {
      if (action.metric === state.geoSizeMetric) return state;
      const next = { ...state, geoSizeMetric: action.metric };
      saveViewConfig(next.mapMode, configOf(next));
      return next;
    }
    case "SET_TIME_WINDOW": {
      if (action.window === state.timeWindow) return state;
      return { ...state, timeWindow: action.window };
    }
    case "SET_SEARCH":
      return { ...state, search: action.query };
    case "SET_SEARCH_OPEN":
      return { ...state, searchOpen: action.open, search: action.open ? state.search : "" };
    case "SET_PINNED":
      return { ...state, pinnedPersonId: action.id };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
