import { useState } from "react";
import type { Collaborations, Person, PatentLinks } from "../../types";
import PatentsDialog from "../PatentsDialog/PatentsDialog";
import { useAppState } from "../../state/AppState";
import openAlexLogo from "../../assets/openalex-logo.png";
import epoLogo from "../../assets/epo-logo.png";
import "./Tooltip.css";

interface TooltipProps {
  person: Person;
  x: number;
  y: number;
  pinned: boolean;
  onClose?: () => void;
  patentLinks?: PatentLinks | null;
  collaborations?: Collaborations | null;
  knownPersonIds?: Set<string>;
  onPinPerson?: (id: string) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Dedupes a list of {id, name} entries by name (case-sensitive exact
 * match), keeping the first occurrence — the same real person sometimes
 * has two different OpenAlex ids in the source data, which otherwise shows
 * up as visually duplicate rows even though the (unique) ids keep React
 * happy. */
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

export default function Tooltip({
  person,
  x,
  y,
  pinned,
  onClose,
  patentLinks,
  collaborations,
  knownPersonIds,
  onPinPerson,
}: TooltipProps) {
  const { dispatch } = useAppState();
  const [patentsOpen, setPatentsOpen] = useState(false);
  const width = 280;
  const left = clamp(x + 16, 8, window.innerWidth - width - 8);
  const top = clamp(y + 16, 8, window.innerHeight - 260);

  const hIndex = person.quantum_h_index ?? person.h_index ?? "?";
  const globalH = person.global_h_index ?? "Not available";

  const collab = collaborations?.[person.id];
  const topCoauthors = dedupeByName(
    (collab?.top_coauthors ?? []).filter((other) => other.id !== person.id && other.name !== person.name),
  ).slice(0, 4);

  return (
    <div
      className={"tooltip glass-panel" + (pinned ? " pinned" : "")}
      style={{ left, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tip-head">
        <div>
          <h3>{person.name}</h3>
          <div className="inst">
            {person.institution} · {person.country}
          </div>
        </div>
        {pinned && (
          <button className="tip-close" type="button" aria-label="Close tooltip" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div className="row">
        <span>Quantum h-index</span>
        <b>{hIndex}</b>
      </div>
      <div className="row">
        <span>Global h-index</span>
        <b>{globalH}</b>
      </div>
      <div className="row">
        <span>Total papers</span>
        <b>
          {person.total_papers} / {person.quantum_papers} quantum
        </b>
      </div>
      {person.total_patents > 0 && (
        <div className="row">
          <span>Patents</span>
          <b>
            {person.total_patents} / {person.quantum_patents} quantum
          </b>
        </div>
      )}
      <div className="row">
        <span>Active years</span>
        <b>
          {person.first_year ?? "?"}–{person.last_year ?? "?"}
        </b>
      </div>
      {person.topic && <div className="pill">{person.topic}</div>}
      {topCoauthors.length > 0 && (
        <div className="collab-section">
          <div className="collab-heading">Top collaborators (quantum)</div>
          {topCoauthors.length > 0 && (
            <div className="collab-row">
              {topCoauthors.map((c) =>
                onPinPerson && (!knownPersonIds || knownPersonIds.has(c.id)) ? (
                  <button
                    key={c.id}
                    type="button"
                    className="collab-chip collab-chip-person collab-chip-btn"
                    onClick={() => onPinPerson(c.id)}
                  >
                    {c.name} <span className="collab-count">{c.papers}</span>
                  </button>
                ) : (
                  <span key={c.id} className="collab-chip collab-chip-person">
                    {c.name} <span className="collab-count">{c.papers}</span>
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}
      <button
        className="tip-details-btn"
        type="button"
        onClick={() => dispatch({ type: "OPEN_EXPLORER", id: person.id })}
      >
        See details
      </button>
      <div className="tip-sources">
        {person.id && (
          <a
            className="tip-source"
            href={person.id}
            target="_blank"
            rel="noopener noreferrer"
            title="View on OpenAlex"
            aria-label="View on OpenAlex"
          >
            <img src={openAlexLogo} alt="" />
          </a>
        )}
        {person.total_patents > 0 && (
          <button
            className="tip-source tip-source-epo"
            type="button"
            onClick={() => setPatentsOpen(true)}
            title={`Author patents (${person.total_patents}) via EPO`}
            aria-label={`Author patents (${person.total_patents})`}
          >
            <img src={epoLogo} alt="" />
          </button>
        )}
      </div>
      {patentsOpen && (
        <PatentsDialog
          person={person}
          onClose={() => setPatentsOpen(false)}
          patentLinks={patentLinks}
          knownPersonIds={knownPersonIds}
        />
      )}
    </div>
  );
}
