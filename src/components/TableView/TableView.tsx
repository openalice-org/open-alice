import { Fragment, useMemo, useState } from "react";
import { useAppState } from "../../state/AppState";
import type { Person } from "../../types";
import { DOMAIN_LABELS } from "../../lib/geoAggregate";
import { dominantDomainOf, type DomainKey } from "../../lib/ternary";
import "./TableView.css";

interface TableViewProps {
  people: Person[]; // pre-filtered by App to the current scope (Nordics/country/university)
}

type SortKey =
  | "name"
  | "institution"
  | "country"
  | "topic"
  | "quantum_h_index"
  | "global_h_index"
  | "quantum_papers"
  | "total_papers"
  | "first_year"
  | "last_year";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "institution", label: "Institution" },
  { key: "country", label: "Country" },
  { key: "topic", label: "Topic" },
  { key: "quantum_h_index", label: "Quantum h-index" },
  { key: "global_h_index", label: "Global h-index" },
  { key: "quantum_papers", label: "Quantum papers" },
  { key: "total_papers", label: "Total papers" },
  { key: "first_year", label: "First year" },
  { key: "last_year", label: "Last year" },
];

const PAGE_SIZE = 100;

function shareOf(p: Person, k: DomainKey): number {
  return (k === "sensing" ? p.sensing_share : k === "communication" ? p.communication_share : p.computing_share) ?? 0;
}

function PersonDetail({ person }: { person: Person }) {
  const dom = dominantDomainOf(person);
  const titles = person.example_titles ?? [];
  return (
    <div className="detail-panel">
      <div className="detail-col">
        <div className="detail-section-label">
          Metrics from OpenAlex
          {person.id && (
            <a className="detail-ext-link" href={person.id} target="_blank" rel="noopener noreferrer">
              ↗
            </a>
          )}
        </div>
        <div className="detail-line">
          <span>Global h-index</span>
          <b>{person.global_h_index ?? "Not available"}</b>
        </div>
        <div className="detail-line">
          <span>Total works</span>
          <b>{person.total_papers}</b>
        </div>
        <div className="detail-line">
          <span>Active years</span>
          <b>
            {person.first_year ?? "?"}–{person.last_year ?? "?"}
          </b>
        </div>

        <div className="detail-section-label">Our reading</div>
        {person.topic && <div className="detail-topic">{person.topic}</div>}
        <div className="detail-line">
          <span>Corpus h-index</span>
          <b>{person.quantum_h_index ?? person.h_index ?? "?"}</b>
        </div>
        <div className="detail-line">
          <span>Works in corpus</span>
          <b>{person.quantum_papers}</b>
        </div>
        <div className="detail-line">
          <span>Domain profile</span>
          <b>{dom ? `${DOMAIN_LABELS[dom]} ${Math.round(shareOf(person, dom) * 100)}%` : "—"}</b>
        </div>
      </div>
      <div className="detail-col">
        <div className="detail-section-label">
          Example corpus works ({titles.length} of {person.quantum_papers})
        </div>
        {titles.length ? (
          <ul className="detail-works-list">
            {titles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : (
          <div className="detail-empty">No example works available</div>
        )}
      </div>
    </div>
  );
}

function valueOf(p: Person, key: SortKey): string | number {
  switch (key) {
    case "quantum_h_index":
      return p.quantum_h_index ?? p.h_index ?? -1;
    case "global_h_index":
      return p.global_h_index ?? -1;
    case "quantum_papers":
      return p.quantum_papers ?? 0;
    case "total_papers":
      return p.total_papers ?? 0;
    case "first_year":
      return p.first_year ?? -1;
    case "last_year":
      return p.last_year ?? -1;
    case "topic":
      return p.topic ?? "";
    default:
      return p[key] ?? "";
  }
}

export default function TableView({ people }: TableViewProps) {
  const { state, dispatch } = useAppState();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("quantum_papers");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? people.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            p.institution.toLowerCase().includes(needle) ||
            (p.topic ?? "").toLowerCase().includes(needle),
        )
      : people;
    const sorted = [...rows].sort((a, b) => {
      const va = valueOf(a, sortKey);
      const vb = valueOf(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb));
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [people, search, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : clampedPage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, clampedPage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  return (
    <div className="table-overlay">
      <div className="table-panel glass-panel">
        <div className="table-toolbar">
          <input
            type="text"
            placeholder="Search name, institution, topic…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <span className="table-count">{filtered.length.toLocaleString()} people</span>
          <div className="table-pager">
            <button type="button" disabled={clampedPage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ‹
            </button>
            <span className="page-label">
              {rangeStart}–{rangeEnd} of {filtered.length} · page {clampedPage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={clampedPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              ›
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="people-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} onClick={() => toggleSort(col.key)}>
                    {col.label}
                    {sortKey === col.key && <span className="sort-arrow">{sortDir === "asc" ? " ▲" : " ▼"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => {
                const expanded = p.id === state.pinnedPersonId;
                return (
                  <Fragment key={p.id}>
                    <tr
                      className={expanded ? "pinned-row" : ""}
                      onClick={() => dispatch({ type: "SET_PINNED", id: expanded ? null : p.id })}
                    >
                      <td>{p.name}</td>
                      <td>{p.institution}</td>
                      <td>{p.country}</td>
                      <td className="topic-cell">{p.topic}</td>
                      <td>{p.quantum_h_index ?? p.h_index ?? "—"}</td>
                      <td>{p.global_h_index ?? "—"}</td>
                      <td>{p.quantum_papers}</td>
                      <td>{p.total_papers}</td>
                      <td>{p.first_year ?? "—"}</td>
                      <td>{p.last_year ?? "—"}</td>
                    </tr>
                    <tr className="detail-row">
                      <td colSpan={COLUMNS.length}>
                        <div className={"detail-collapse" + (expanded ? " expanded" : "")}>
                          <div className="detail-collapse-inner">
                            <PersonDetail person={p} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
