import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppState } from "../../state/AppState";
import type { Person, PatentLinks } from "../../types";
import "./PatentsDialog.css";

interface PatentsDialogProps {
  person: Person;
  onClose: () => void;
  patentLinks?: PatentLinks | null;
}

/** Modal listing a person's own SE-inventor/uni-applicant filtered patents
 * (person.patents, from SPRINT 13's build_author_patents.py) — the same set
 * `total_patents` counts. Opened from the "Author patents" link in Tooltip.
 * Portaled to document.body (same reasoning as Rail's Popout: a nested
 * backdrop-filter under an ancestor that already has one samples the
 * ancestor's blurred output instead of the real page). */
export default function PatentsDialog({ person, onClose, patentLinks }: PatentsDialogProps) {
  const { dispatch } = useAppState();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const patents = person.patents ?? [];

  function goToPerson(id: string) {
    dispatch({ type: "SET_PINNED", id });
    onClose();
  }

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
            patents.map((p) => {
              const coInventors = (patentLinks?.[p.epo_id] ?? []).filter(
                (other) => other.id !== person.id && other.name !== person.name,
              );
              return (
                <div className="patent-row" key={p.epo_id}>
                  <a href={p.link} target="_blank" rel="noopener noreferrer">
                    {p.title || p.epo_id}
                  </a>
                  <div className="patent-meta">
                    {p.epo_id}
                    {p.year ? ` · ${p.year}` : ""}
                  </div>
                  {coInventors.length > 0 && (
                    <div className="patent-meta patent-co-inventors">
                      Also invented by:{" "}
                      {coInventors.map((other, i) => (
                        <span key={other.id}>
                          <button
                            type="button"
                            className="patent-co-inventor-btn"
                            onClick={() => goToPerson(other.id)}
                          >
                            {other.name}
                          </button>
                          {i < coInventors.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="patent-empty">No SE-inventor / applicant-matched patent records for this person.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
