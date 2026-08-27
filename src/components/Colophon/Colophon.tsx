import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../state/AppState";
import type { Person, PaperCounts } from "../../types";
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
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  // Open landing on the level relevant to where you already are: inside
  // Sweden (a Swedish university, or "All of Sweden"), it opens straight
  // into Sweden's list rather than making you drill down again.
  function openMenu() {
    setMenuCountry(scopeCountry && countries.includes(scopeCountry) ? scopeCountry : null);
    setOpen(true);
  }

  function pick(scope: string) {
    dispatch({ type: "SET_SCOPE", scope });
    setOpen(false);
  }

  const scopedPeople = useMemo(() => {
    return peopleForScope(people, state.scope, uniCountry);
  }, [people, state.scope, uniCountry]);

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
          Quantum <span>@</span>{" "}
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
            <i className="ph-light ph-caret-up" />
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
                    All Nordics
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
        </div>
        <div className="nums">
          <span>{fmtInt(scopedPeople.length)} people</span> · <span>{fmtInt(paperCount)} papers</span>
        </div>
    </div>
  );
}
