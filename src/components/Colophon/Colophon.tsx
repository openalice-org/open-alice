import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../state/AppState";
import type { Person, PaperCounts, TimeWindow } from "../../types";
import {
  COUNTRY_LABELS,
  COUNTRY_ORDER,
  NORDICS_SCOPE,
  institutionsByCountry,
  isGeoScope,
  labelForScope,
  peopleForScope,
  universityCountryMap,
} from "../../lib/institutions";
import { fmtInt } from "../../lib/format";
import { filterByTimeWindow, timeWindowCutoff } from "../../lib/people";
import "./Colophon.css";

interface ColophonProps {
  people: Person[];
  paperCounts: PaperCounts | null;
}

export default function Colophon({ people, paperCounts }: ColophonProps) {
  const { state, dispatch } = useAppState();
  const [open, setOpen] = useState(false);
  // Which level of the picker is showing: null = the Nordics-wide root
  // (All Nordics + one row per country); a country code = that country's
  // "All of X" + its universities. Navigating between levels does NOT
  // change state.scope — only picking a leaf (All Nordics, All of X, or a
  // university) does.
  const [menuCountry, setMenuCountry] = useState<string | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const byCountry = useMemo(() => institutionsByCountry(people), [people]);
  const uniCountry = useMemo(() => universityCountryMap(people), [people]);
  const countries = COUNTRY_ORDER.filter((cc) => (byCountry.get(cc)?.length ?? 0) > 0);

  const scopeCountry = state.scope.startsWith("country:")
    ? state.scope.slice("country:".length)
    : uniCountry.get(state.scope);

  useEffect(() => {
    function onDocClick() {
      setOpen(false);
      setTimeOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Open landing on the level relevant to where you already are: inside
  // Sweden (a Swedish university, or "All of Sweden"), it opens straight
  // into Sweden's list rather than making you drill down again.
  function openMenu() {
    setMenuCountry(scopeCountry && countries.includes(scopeCountry) ? scopeCountry : null);
    setTimeOpen(false);
    setOpen(true);
  }

  function pick(scope: string) {
    dispatch({ type: "SET_SCOPE", scope });
    setOpen(false);
  }

  function openTimeMenu() {
    setOpen(false);
    setTimeOpen(true);
  }

  function pickTime(window: TimeWindow) {
    dispatch({ type: "SET_TIME_WINDOW", window });
    setTimeOpen(false);
  }

  // "All corpus" reads as "Since <oldest year>" — the earliest first_year
  // across the WHOLE dataset (people is unscoped, the full corpus App.tsx
  // passes in), not just the current scope, so the label doesn't shift as
  // you change university/country. last5/last10 reuse the exact cutoff
  // year filterByTimeWindow itself filters on, so the label never drifts
  // out of sync with what's actually included.
  const timeWindowLabels = useMemo<Record<TimeWindow, string>>(() => {
    let oldestYear: number | null = null;
    for (const p of people) {
      if (p.first_year != null && (oldestYear == null || p.first_year < oldestYear)) oldestYear = p.first_year;
    }
    return {
      all: oldestYear != null ? `Since ${oldestYear}` : "All corpus",
      last5: `Since ${timeWindowCutoff("last5")}`,
      last10: `Since ${timeWindowCutoff("last10")}`,
    };
  }, [people]);

  const scopedPeople = useMemo(() => {
    return filterByTimeWindow(peopleForScope(people, state.scope, uniCountry), state.timeWindow);
  }, [people, state.scope, uniCountry, state.timeWindow]);

  const paperCount = useMemo(() => {
    if (isGeoScope(state.scope) && paperCounts) {
      if (state.scope === NORDICS_SCOPE) return paperCounts.total;
      const cc = state.scope.slice("country:".length);
      const distinct = paperCounts.by_country[cc];
      if (distinct != null) return distinct;
    }
    return scopedPeople.reduce((sum, p) => sum + (p.quantum_papers || 0), 0);
  }, [scopedPeople, paperCounts, state.scope]);

  return (
    <div className="colophon" ref={rootRef}>
        <div className="brand">
          Quantum <span>/</span>{" "}
          <span
            className={"inst-pick" + (open ? " open" : "")}
            tabIndex={0}
            role="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            title="Change institution"
            onClick={(e) => {
              e.stopPropagation();
              if (open) setOpen(false);
              else openMenu();
            }}
          >
            <span>{labelForScope(state.scope)}</span>
          </span>
          {open && (
            <div className="inst-menu glass-panel" role="listbox" onClick={(e) => e.stopPropagation()}>
              {menuCountry == null ? (
                <>
                  <div
                    className={"inst-opt inst-all" + (state.scope === NORDICS_SCOPE ? " active" : "")}
                    role="option"
                    aria-selected={state.scope === NORDICS_SCOPE}
                    onClick={() => pick(NORDICS_SCOPE)}
                  >
                    <i className={"ph-light inst-check " + (state.scope === NORDICS_SCOPE ? "ph-check-square" : "ph-square")} />
                    All New Nordics
                  </div>
                  {countries.map((cc) => (
                    <div
                      key={cc}
                      className={"inst-opt inst-drill" + (scopeCountry === cc ? " active" : "")}
                      role="option"
                      onClick={() => setMenuCountry(cc)}
                    >
                      {COUNTRY_LABELS[cc] ?? cc}
                      <i className="ph-light ph-caret-right" />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="inst-crumb" onClick={() => setMenuCountry(null)}>
                    <i className="ph-light ph-caret-left" />
                    {COUNTRY_LABELS[menuCountry] ?? menuCountry}
                  </div>
                  <div
                    className={"inst-opt inst-all" + (state.scope === "country:" + menuCountry ? " active" : "")}
                    role="option"
                    aria-selected={state.scope === "country:" + menuCountry}
                    onClick={() => pick("country:" + menuCountry)}
                  >
                    <i
                      className={
                        "ph-light inst-check " + (state.scope === "country:" + menuCountry ? "ph-check-square" : "ph-square")
                      }
                    />
                    All of {COUNTRY_LABELS[menuCountry] ?? menuCountry}
                  </div>
                  {(byCountry.get(menuCountry) ?? []).map((uni) => (
                    <div
                      key={uni}
                      className={"inst-opt" + (state.scope === uni ? " active" : "")}
                      role="option"
                      aria-selected={state.scope === uni}
                      onClick={() => pick(uni)}
                    >
                      <i className={"ph-light inst-check " + (state.scope === uni ? "ph-check-square" : "ph-square")} />
                      {uni}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          <span> / </span>
          <span
            className={"inst-pick" + (timeOpen ? " open" : "")}
            tabIndex={0}
            role="button"
            aria-haspopup="listbox"
            aria-expanded={timeOpen}
            title="Change time window"
            onClick={(e) => {
              e.stopPropagation();
              if (timeOpen) setTimeOpen(false);
              else openTimeMenu();
            }}
          >
            <span>{timeWindowLabels[state.timeWindow]}</span>
          </span>
          {timeOpen && (
            <div className="inst-menu glass-panel" role="listbox" onClick={(e) => e.stopPropagation()}>
              {(Object.keys(timeWindowLabels) as TimeWindow[]).map((w) => (
                <div
                  key={w}
                  className={"inst-opt inst-all" + (state.timeWindow === w ? " active" : "")}
                  role="option"
                  aria-selected={state.timeWindow === w}
                  onClick={() => pickTime(w)}
                >
                  <i className={"ph-light inst-check " + (state.timeWindow === w ? "ph-check-square" : "ph-square")} />
                  {timeWindowLabels[w]}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="nums">
          <span>{fmtInt(scopedPeople.length)} people</span> · <span>{fmtInt(paperCount)} papers</span>
        </div>
    </div>
  );
}
