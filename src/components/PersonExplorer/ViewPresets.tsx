import type { ViewId } from "../PaperCube/PaperCube";
import "./ViewPresets.css";

interface ViewPresetsProps {
  active: ViewId | null;
  onPick: (id: ViewId) => void;
}

// Corner colours (same as the 3D triangle): A = Sensing, B = Communication, C = Computing.
const COL = { A: "#3b82f6", B: "#22c55e", C: "#ef4444" };
type P = [number, number];
// Top-down glyph: Sensing apex, Communication bottom-left, Computing bottom-right.
const PT: Record<"A" | "B" | "C", P> = { A: [12, 3], B: [3, 19], C: [21, 19] };
const EDGES = [
  { id: "AB" as const, from: "A" as const, to: "B" as const },
  { id: "BC" as const, from: "B" as const, to: "C" as const },
  { id: "CA" as const, from: "C" as const, to: "A" as const },
];
const LABEL: Record<string, string> = {
  AB: "Sensing / Communication",
  BC: "Communication / Computing",
  CA: "Computing / Sensing",
};

/** One shared set of edge gradients (each runs between the two corner colours of its edge). */
function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {EDGES.map((e) => (
          <linearGradient
            key={e.id}
            id={`vp-edge-${e.id}`}
            gradientUnits="userSpaceOnUse"
            x1={PT[e.from][0]}
            y1={PT[e.from][1]}
            x2={PT[e.to][0]}
            y2={PT[e.to][1]}
          >
            <stop offset="0" stopColor={COL[e.from]} />
            <stop offset="1" stopColor={COL[e.to]} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/** Triangle glyph: faint outline; `lit` edges are drawn thick in their gradient. */
function Glyph({ lit }: { lit: ("AB" | "BC" | "CA")[] }) {
  const pts = `${PT.A.join(",")} ${PT.B.join(",")} ${PT.C.join(",")}`;
  return (
    <svg className="vp-glyph" viewBox="0 0 24 22" aria-hidden="true">
      <polygon points={pts} className="vp-tri" />
      {EDGES.filter((e) => lit.includes(e.id)).map((e) => (
        <line
          key={e.id}
          x1={PT[e.from][0]}
          y1={PT[e.from][1]}
          x2={PT[e.to][0]}
          y2={PT[e.to][1]}
          stroke={`url(#vp-edge-${e.id})`}
          className="vp-edge"
        />
      ))}
    </svg>
  );
}

export default function ViewPresets({ active, onPick }: ViewPresetsProps) {
  return (
    <div className="view-presets" role="group" aria-label="Preset views">
      <Defs />
      <div className="vp-row">
        {EDGES.map((e) => (
          <button
            key={e.id}
            type="button"
            className={"vp-btn vp-side" + (active === e.id ? " active" : "")}
            title={`${LABEL[e.id]}: square-on to that face, time against that axis`}
            aria-label={LABEL[e.id]}
            aria-pressed={active === e.id}
            onClick={() => onPick(e.id)}
          >
            <Glyph lit={[e.id]} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className={"vp-btn vp-all" + (active === "top" ? " active" : "")}
        title="All papers: from above, every year flattened onto the triangle"
        aria-label="All papers, from above"
        aria-pressed={active === "top"}
        onClick={() => onPick("top")}
      >
        <Glyph lit={["AB", "BC", "CA"]} />
      </button>
    </div>
  );
}
