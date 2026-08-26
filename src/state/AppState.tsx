import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { AggMode, BoxOrient, GlassesMode, MapMode } from "../types";
import { NORDICS_SCOPE, isGeoScope } from "../lib/institutions";
import { taxScopeAllowed } from "../lib/taxonomy";
import { aggModeAllowed } from "../lib/aggMode";

const HISTORY_LIMIT = 100;

// One entry per region (scope), lens (mapMode), emphasis (glassesMode), or
// configuration (aggMode/boxOrient) change — a full undo stack, not just a
// single "previous" slot, so the rail's Back button can walk all the way
// back through a session (see the History bubble in Rail.tsx).
interface ViewSnapshot {
  scope: string;
  mapMode: MapMode;
  glassesMode: GlassesMode;
  aggMode: AggMode;
  boxOrient: BoxOrient;
}

export interface AppState {
  scope: string; // institution name | "country:XX" | "Nordics"
  glassesMode: GlassesMode;
  mapMode: MapMode;
  aggMode: AggMode; // positional overlay shared by the Glasses (boxplot/hexdensity) and Aggregations (clusters) lenses
  boxOrient: BoxOrient;
  search: string;
  searchOpen: boolean;
  pinnedPersonId: string | null;
  history: ViewSnapshot[]; // stack; GO_BACK pops the top entry
}

const initialState: AppState = {
  scope: NORDICS_SCOPE,
  glassesMode: "quantum_h_index",
  mapMode: "geo",
  aggMode: "none",
  boxOrient: "h",
  search: "",
  searchOpen: false,
  pinnedPersonId: null,
  history: [],
};

type Action =
  | { type: "SET_SCOPE"; scope: string }
  | { type: "SET_GLASSES"; mode: GlassesMode }
  | { type: "SET_MAP"; mode: MapMode; scope?: string }
  | { type: "SET_AGG"; mode: AggMode }
  | { type: "SET_BOX_ORIENT"; orient: BoxOrient }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_SEARCH_OPEN"; open: boolean }
  | { type: "SET_PINNED"; id: string | null }
  | { type: "GO_BACK" };

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
// scope while one's active falls back to that view's aggregate option
// (Density for Domains, Boxplot for Axes) instead.
function aggForScope(mapMode: MapMode, agg: AggMode, scope: string): AggMode {
  if (!isGeoScope(scope)) return agg;
  if (mapMode === "domains" && (agg === "none" || agg === "clusters")) return "hexdensity";
  if (mapMode === "cartesian" && agg === "none") return "boxplot";
  return agg;
}

function snapshotOf(state: AppState): ViewSnapshot {
  return {
    scope: state.scope,
    mapMode: state.mapMode,
    glassesMode: state.glassesMode,
    aggMode: state.aggMode,
    boxOrient: state.boxOrient,
  };
}

function pushHistory(state: AppState): ViewSnapshot[] {
  const next = [...state.history, snapshotOf(state)];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
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
        history: pushHistory(state),
      };
    }
    case "SET_GLASSES": {
      // Layers (radius weighting) and Config's positional overlay (aggMode)
      // are independent controls now — picking a weighting metric shouldn't
      // touch whichever Domains/Axes lens is currently active.
      if (action.mode === state.glassesMode) return state;
      return { ...state, glassesMode: action.mode, history: pushHistory(state) };
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
      return {
        ...state,
        mapMode: action.mode,
        aggMode,
        scope,
        pinnedPersonId: null,
        history: pushHistory(state),
      };
    }
    case "SET_AGG": {
      if (action.mode === state.aggMode) return state;
      return { ...state, aggMode: action.mode, history: pushHistory(state) };
    }
    case "SET_BOX_ORIENT": {
      if (action.orient === state.boxOrient) return state;
      return { ...state, boxOrient: action.orient, history: pushHistory(state) };
    }
    case "SET_SEARCH":
      return { ...state, search: action.query };
    case "SET_SEARCH_OPEN":
      return { ...state, searchOpen: action.open, search: action.open ? state.search : "" };
    case "SET_PINNED":
      return { ...state, pinnedPersonId: action.id };
    case "GO_BACK": {
      if (!state.history.length) return state;
      const last = state.history[state.history.length - 1];
      return {
        ...state,
        scope: last.scope,
        mapMode: last.mapMode,
        glassesMode: last.glassesMode,
        aggMode: last.aggMode,
        boxOrient: last.boxOrient,
        pinnedPersonId: null,
        history: state.history.slice(0, -1),
      };
    }
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
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

export function useAppState(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
