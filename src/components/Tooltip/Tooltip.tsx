import { useState } from "react";
import type { Collaborations, Person, PatentLinks } from "../../types";
import PatentsDialog from "../PatentsDialog/PatentsDialog";
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
  const topInstitutions = collab?.top_institutions?.slice(0, 3) ?? [];
  const hasCollab = topCoauthors.length > 0 || topInstitutions.length > 0;

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
      {hasCollab && (
        <div className="collab-section">
          <div className="collab-heading">Top collaborators (quantum)</div>
          {topCoauthors.length > 0 && (
            <div className="collab-row">
              {topCoauthors.map((c) =>
                onPinPerson && (!knownPersonIds || knownPersonIds.has(c.id)) ? (
                  <button
                    key={c.id}
                    type="button"
                    className="collab-chip collab-chip-btn"
                    onClick={() => onPinPerson(c.id)}
                  >
                    {c.name} <span className="collab-count">{c.papers}</span>
                  </button>
                ) : (
                  <span key={c.id} className="collab-chip">
                    {c.name} <span className="collab-count">{c.papers}</span>
                  </span>
                ),
              )}
            </div>
          )}
          {topInstitutions.length > 0 && (
            <div className="collab-row">
              {topInstitutions.map((inst) => (
                <span key={inst.name} className="collab-chip">
                  {inst.name} <span className="collab-count">{inst.papers}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {person.total_patents > 0 && (
        <button className="tip-link tip-link-btn" type="button" onClick={() => setPatentsOpen(true)}>
          Author patents ↗
        </button>
      )}
      {person.id && (
        <a className="tip-link" href={person.id} target="_blank" rel="noopener noreferrer">
          OpenAlex ↗
        </a>
      )}
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
