import { Suspense, lazy, useMemo } from "react";
import { AppStateProvider, useAppState } from "./state/AppState";
import { useDataset } from "./hooks/useDataset";
import { peopleForScope, universityCountryMap } from "./lib/institutions";
import { filterByTimeWindow, paperCountsForWindow } from "./lib/people";
import Rail from "./components/Rail/Rail";
import Colophon from "./components/Colophon/Colophon";
import ScatterView from "./components/ScatterView/ScatterView";
import GeoView from "./components/GeoView/GeoView";
import TaxonomyView from "./components/TaxonomyView/TaxonomyView";
import TableView, { PersonDetail } from "./components/TableView/TableView";
import "./App.css";
import { useWindowedShares } from "./hooks/useWindowedShares";
import type { Person } from "./types";

// three.js is heavy; only fetch it when someone opens a person's details.
const PersonExplorer = lazy(() => import("./components/PersonExplorer/PersonExplorer"));

const NO_PEOPLE: Person[] = [];

function AppInner() {
  const { dataset, paperCounts, patentLinks, collaborations, loading, error } = useDataset();
  const { state, dispatch } = useAppState();

  const universityCountries = useMemo(() => (dataset ? universityCountryMap(dataset.people) : new Map<string, string>()), [dataset]);

  // everyone, with domain shares recomputed for the active time window
  const windowedPeople = useWindowedShares(dataset?.people ?? NO_PEOPLE, state.timeWindow);

  const scopedPeople = useMemo(() => {
    if (!dataset) return [];
    return peopleForScope(windowedPeople, state.scope, universityCountries);
  }, [dataset, windowedPeople, state.scope, universityCountries]);

  const visiblePeople = useMemo(() => filterByTimeWindow(scopedPeople, state.timeWindow), [scopedPeople, state.timeWindow]);

  const timeFilteredPeople = useMemo(
    () => (dataset ? filterByTimeWindow(windowedPeople, state.timeWindow) : []),
    [dataset, windowedPeople, state.timeWindow],
  );

  const windowedPaperCounts = useMemo(
    () => paperCountsForWindow(paperCounts, state.timeWindow),
    [paperCounts, state.timeWindow],
  );

  // The full set of person ids actually present in the loaded dataset —
  // used by Tooltip/PatentsDialog to decide whether a coauthor chip or
  // co-inventor link is a valid SET_PINNED target. collaborations.json and
  // patent_links.json can reference ids (other institutions, or ids absent
  // from people_viz.json entirely) that ScatterView/TaxonomyView can never
  // resolve a pin against, which otherwise makes the click silently no-op.
  const knownPersonIds = useMemo(() => new Set(dataset?.people.map((p) => p.id) ?? []), [dataset]);

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-message">Loading Nordic quantum researchers…</div>
      </div>
    );
  }

  if (error || !dataset) {
    return (
      <div className="boot-screen">
        <div className="boot-message error">Failed to load dataset: {error ?? "unknown error"}</div>
      </div>
    );
  }

  return (
    <div className="app-root">
      {state.mapMode === "taxonomy" ? (
        <TaxonomyView
          paperCounts={windowedPaperCounts}
          patentLinks={patentLinks}
          collaborations={collaborations}
          knownPersonIds={knownPersonIds}
        />
      ) : state.mapMode === "geo" ? (
        <GeoView people={timeFilteredPeople} paperCounts={windowedPaperCounts} />
      ) : state.mapMode === "list" ? (
        <TableView people={visiblePeople} />
      ) : (
        <ScatterView
          dataset={dataset}
          people={visiblePeople}
          patentLinks={patentLinks}
          collaborations={collaborations}
          knownPersonIds={knownPersonIds}
        />
      )}

      <Rail people={dataset.people} />
      <Colophon people={dataset.people} paperCounts={paperCounts} />

      {state.explorerPersonId &&
        (() => {
          const person = dataset.people.find((p) => p.id === state.explorerPersonId);
          return person ? (
            <Suspense fallback={null}>
              <PersonExplorer
                key={person.id}
                person={person}
                detail={<PersonDetail person={person} />}
                onClose={() => dispatch({ type: "OPEN_EXPLORER", id: null })}
              />
            </Suspense>
          ) : null;
        })()}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}
