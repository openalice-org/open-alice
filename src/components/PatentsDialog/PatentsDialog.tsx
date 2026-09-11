import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Person } from "../../types";
import "./PatentsDialog.css";

interface PatentsDialogProps {
  person: Person;
  onClose: () => void;
}

/** Modal listing a person's own SE-inventor/uni-applicant filtered patents
 * (person.patents, from SPRINT 13's build_author_patents.py) — the same set
 * `total_patents` counts. Opened from the "Author patents" link in Tooltip.
 * Portaled to document.body (same reasoning as Rail's Popout: a nested
 * backdrop-filter under an ancestor that already has one samples the
 * ancestor's blurred output instead of the real page). */
export default function PatentsDialog({ person, onClose }: PatentsDialogProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const patents = person.patents ?? [];

  return createPortal(
    <div
      className="patents-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="patents-dialog glass-panel" role="dialog" aria-modal="true" aria-labelledby="patents-dialog-title">
        <div className="patents-dialog-head">
          <h3 id="patents-dialog-title">{person.name} · patents</h3>
          <button className="tip-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="patents-dialog-list">
          {patents.length ? (
            patents.map((p) => (
              <div className="patent-row" key={p.epo_id}>
                <a href={p.link} target="_blank" rel="noopener noreferrer">
                  {p.title || p.epo_id}
                </a>
                <div className="patent-meta">
                  {p.epo_id}
                  {p.year ? ` · ${p.year}` : ""}
                </div>
              </div>
            ))
          ) : (
            <div className="patent-empty">No SE-inventor / applicant-matched patent records for this person.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
