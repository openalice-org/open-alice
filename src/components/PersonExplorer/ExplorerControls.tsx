import { useEffect, useRef, useState } from "react";
import { Popout } from "../Rail/Rail";
import type { CubeMode, PaperSizeMetric, ViewId } from "../PaperCube/PaperCube";
import type { TrajectoryWeight } from "../../lib/trajectory";
import ViewPresets from "./ViewPresets";
import "./ExplorerControls.css";

interface ExplorerControlsProps {
  mode: CubeMode;
  onMode: (m: CubeMode) => void;
  sizeBy: PaperSizeMetric;
  onSizeBy: (s: PaperSizeMetric) => void;
  weightBy: TrajectoryWeight;
  onWeightBy: (w: TrajectoryWeight) => void;
  ghost: boolean;
  onGhost: (g: boolean) => void;
  activeView: ViewId | null;
  onPickView: (id: ViewId) => void;
  onClose: () => void;
}

const MODES: { key: CubeMode; label: string; icon: string }[] = [
  { key: "papers", label: "Papers", icon: "ph-dots-nine" },
  { key: "trajectory", label: "Trajectory", icon: "ph-path" },
];

const SIZE: { key: PaperSizeMetric; label: string }[] = [
  { key: "citations", label: "Citations" },
  { key: "coauthors", label: "Coauthors" },
  { key: "constant", label: "Equal" },
];

const WEIGHT: { key: TrajectoryWeight; label: string }[] = [
  { key: "papers", label: "Papers" },
  { key: "citations", label: "Citations" },
];

/**
 * The explorer's own lens + cog, mirroring the app's rail: the eyeglasses
 * button switches between Papers and Trajectory; the gear opens that mode's
 * options plus the camera views. (Popouts are portaled, same as the Rail's.)
 */
export default function ExplorerControls(props: ExplorerControlsProps) {
  const { mode, onMode, activeView, onPickView, onClose } = props;
  const [open, setOpen] = useState<"lens" | "config" | null>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => setOpen(null);
    // Deferred past mount, for two reasons: (1) the click that opened this modal is still
    // bubbling to `document` and would close the menu at once; (2) a Popout measures its
    // anchor in a layout effect, which on the very first commit runs before the anchor's ref
    // is attached. The cog starts open, like the app's own rail.
    const t = window.setTimeout(() => {
      setOpen("config");
      document.addEventListener("click", close);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
    };
  }, []);

  const btn = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={"config-btn" + (active ? " active" : "")} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <>
      <div className="pe-rail pe-rail-left glass-panel">
        <div className="rail-row lens" title="View" ref={lensRef}>
          <div
            className="rail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(open === "lens" ? null : "lens");
            }}
          >
            <i className="ph-light ph-eyeglasses" />
          </div>
          {open === "lens" && (
            <Popout anchorRef={lensRef} side="right" align="top" className="menu pe-pop">
              <div className="menu-head">Mode</div>
              {MODES.map((m) => (
                <div
                  key={m.key}
                  className={"menu-opt" + (m.key === mode ? " active" : "")}
                  onClick={() => {
                    onMode(m.key);
                    setOpen(null);
                  }}
                >
                  <i className={"ph-light " + m.icon} /> {m.label}
                </div>
              ))}
            </Popout>
          )}
        </div>
      </div>

      <div className="pe-rail pe-rail-right glass-panel">
        <div className="rail-row config" title="Config" ref={cfgRef}>
          {open === "config" && (
            <Popout anchorRef={cfgRef} side="left" align="center" className="config-buttons pe-pop">
              {mode === "papers" ? (
                <>
                  <span className="config-label">Size by</span>
                  {SIZE.map((o) => btn(o.key === props.sizeBy, o.label, () => props.onSizeBy(o.key)))}
                </>
              ) : (
                <>
                  <span className="config-label">Weight by</span>
                  {WEIGHT.map((o) => btn(o.key === props.weightBy, o.label, () => props.onWeightBy(o.key)))}
                  <span className="config-sep">|</span>
                  <span className="config-label">Papers</span>
                  {btn(props.ghost, "Show", () => props.onGhost(true))}
                  {btn(!props.ghost, "Hide", () => props.onGhost(false))}
                </>
              )}
              <span className="config-sep">|</span>
              <ViewPresets active={activeView} onPick={onPickView} />
              <span className="config-sep">|</span>
              <button type="button" className="config-btn" onClick={() => onPickView("home")}>
                Reset view
              </button>
            </Popout>
          )}
          <div
            className="rail-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(open === "config" ? null : "config");
            }}
          >
            <i className="ph-light ph-gear" />
          </div>
        </div>
        <div className="rail-row">
          <div className="rail-btn" title="Close" onClick={onClose}>
            <i className="ph-light ph-x" />
          </div>
        </div>
      </div>
    </>
  );
}
