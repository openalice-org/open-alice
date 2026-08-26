import { useMemo } from "react";
import { AppStateProvider, useAppState } from "./state/AppState";
import { useDataset } from "./hooks/useDataset";
import { NORDICS_SCOPE, universityCountryMap } from "./lib/institutions";
import Rail from "./components/Rail/Rail";
import Colophon from "./components/Colophon/Colophon";
import ScatterView from "./components/ScatterView/ScatterView";
import GeoView from "./components/GeoView/GeoView";
import TaxonomyView from "./components/TaxonomyView/TaxonomyView";
import TableView from "./components/TableView/TableView";
import "./App.css";

function AppInner() {
  const { dataset, paperCounts, loading, error } = useDataset();
  const { state } = useAppState();

  // Domains now renders at any scope level (Nordics/country/university), so
  // this has to resolve a "country:XX" scope down to that country's people
  // rather than the whole Nordics — the old blanket isGeoScope branch only
  // ever had to distinguish "some geo scope" from "one university" because
  // Scatter (Cartesian/Domains) never actually rendered at a geo scope.
  const scopedPeople = useMemo(() => {
    if (!dataset) return [];
    if (state.scope === NORDICS_SCOPE) return dataset.people;
    if (state.scope.startsWith("country:")) {
      const cc = state.scope.slice("country:".length);
      const uniCountry = universityCountryMap(dataset.people);
      return dataset.people.filter((p) => uniCountry.get(p.university) === cc);
    }
    return dataset.people.filter((p) => p.university === state.scope);
  }, [dataset, state.scope]);

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
        <TaxonomyView />
      ) : state.mapMode === "geo" ? (
        <GeoView people={dataset.people} paperCounts={paperCounts} />
      ) : state.mapMode === "list" ? (
        <TableView people={scopedPeople} />
      ) : (
        <ScatterView dataset={dataset} people={scopedPeople} />
      )}

      <Rail people={dataset.people} />
      <Colophon people={dataset.people} paperCounts={paperCounts} />
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
