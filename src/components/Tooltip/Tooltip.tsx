import type { Person } from "../../types";
import "./Tooltip.css";

interface TooltipProps {
  person: Person;
  x: number;
  y: number;
  pinned: boolean;
  onClose?: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function Tooltip({ person, x, y, pinned, onClose }: TooltipProps) {
  const width = 280;
  const left = clamp(x + 16, 8, window.innerWidth - width - 8);
  const top = clamp(y + 16, 8, window.innerHeight - 260);

  const hIndex = person.quantum_h_index ?? person.h_index ?? "?";
  const globalH = person.global_h_index ?? "Not available";

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
      <div className="row">
        <span>Active years</span>
        <b>
          {person.first_year ?? "?"}–{person.last_year ?? "?"}
        </b>
      </div>
      {person.topic && <div className="pill">{person.topic}</div>}
      {person.id && (
        <a className="tip-link" href={person.id} target="_blank" rel="noopener noreferrer">
          OpenAlex ↗
        </a>
      )}
    </div>
  );
}
