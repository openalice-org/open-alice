import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition"; // augments Selection with .transition() used below
import { scaleLinear, scaleSqrt } from "d3-scale";
import { max } from "d3-array";
import {
  forceSimulation,
  forceX,
  forceY,
  forceManyBody,
  forceCollide,
  forceLink,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { useAppState } from "../../state/AppState";
import { isGeoScope } from "../../lib/institutions";
import { matchesPersonSearch } from "../../lib/people";
import type { Collaborations, Dataset, GlassesMode, Person, PatentLinks } from "../../types";
import {
  hasShares,
  ternaryUnit,
  domainColorOf,
  dominantDomainOf,
  boundaryPairOf,
  DOMAIN_COLORS_PRIMARY,
  TRI,
  type DomainKey,
} from "../../lib/ternary";
import { BOX_ROWS, BOX_COLS, computeBoxBins, boxGeom } from "../../lib/boxplot";
import { hexRadius, hexbinCells, hexagonPath, hexAlpha, cssRgbToTuple } from "../../lib/hexbin";
import { aggregateGeo } from "../../lib/geoAggregate";
import Tooltip from "../Tooltip/Tooltip";
import "./ScatterView.css";

interface ScatterViewProps {
  dataset: Dataset;
  people: Person[]; // already scoped to the current institution
  patentLinks?: PatentLinks | null;
  collaborations?: Collaborations | null;
  knownPersonIds?: Set<string>;
}

const MARGIN = 90;

// Hex density owns low zoom, raw points own high zoom — crossfade between
// them over this zoom-scale band instead of an all-or-nothing swap, so
// zooming in past a threshold reveals the real points underneath (ported
// from SPRINT 13's HEX_FADE_LO/HEX_FADE_HI).
const HEX_FADE_LO = 1.9;
const HEX_FADE_HI = 3.3;
function hexFadeOpacity(k: number): number {
  if (k <= HEX_FADE_LO) return 1;
  if (k >= HEX_FADE_HI) return 0;
  return 1 - (k - HEX_FADE_LO) / (HEX_FADE_HI - HEX_FADE_LO);
}

// Primary domain (clusters) reads a bit small at the shared point radius —
// bumped up just for this glyph rather than the shared radiusScale, which
// also drives Domain mix/Axes sizing. The collide force's boost is kept
// LARGER than the render boost on purpose — it's the spacing between
// circles, not the circles themselves, so the visible dot can be smaller
// while the sim still keeps them loosely apart.
const CLUSTER_R_BOOST = 1.5;
const CLUSTER_COLLIDE_BOOST = 2.1;

// Rail's Emphasis dropdown owns the real label list — duplicated as a
// 2-entry lookup here rather than importing from Rail.tsx, since the legend
// only ever needs to echo the current one back as plain text.
const EMPHASIS_LABEL: Record<string, string> = {
  quantum_h_index: "Corpus influence",
  constant: "Equal weight",
};

/** Shared by radiusScale/intensityScale below — the value each glasses mode
 * weights a point by. "constant" is handled separately by each scale's own
 * early return, so it never reaches here. */
function emphasisMetricOf(mode: GlassesMode, p: Person): number {
  if (mode === "global_h_index") return p.global_h_index ?? 0;
  return p.quantum_h_index ?? p.h_index ?? 0;
}

// The three unordered domain pairs, each already in the same canonical
// DOMAIN_ORDER boundaryPairOf returns — so `${a}-${b}` is a stable id both
// here (building the zebra <pattern> defs) and at each point's fill lookup.
const BOUNDARY_PAIRS: [DomainKey, DomainKey][] = [
  ["sensing", "communication"],
  ["sensing", "computing"],
  ["communication", "computing"],
];

export default function ScatterView({ dataset, people, patentLinks, collaborations, knownPersonIds }: ScatterViewProps) {
  const { state, dispatch } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoverScreen, setHoverScreen] = useState<{ x: number; y: number } | null>(null);
  const [hoveredPatent, setHoveredPatent] = useState<{ id: string; title?: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // ResizeObserver over a window "resize" listener: this view's box can
    // change size from things other than the browser window resizing (a
    // sidebar panel toggling, devtools opening/closing, etc.), and a stale
    // `size` here is exactly what desyncs the domains triangle/labels from
    // the actual viewport.
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // domains mode only shows people with all three domain shares present —
  // but everyone stays mounted across a mode switch (see projectOf/render
  // below) so the transition reads as a flight + fade, not a jump cut.

  const { xScale, yScale } = useMemo(() => {
    const xDom = Math.max(0.2, max(people, (d) => Math.abs(d.x)) ?? 1) * 1.12;
    const yDom = Math.max(0.2, max(people, (d) => Math.abs(d.y)) ?? 1) * 1.12;
    return {
      xScale: scaleLinear().domain([-xDom, xDom]).range([MARGIN, size.width - MARGIN]),
      yScale: scaleLinear().domain([-yDom, yDom]).range([size.height - MARGIN, MARGIN]),
    };
  }, [people, size]);

  const triX = useCallback((u: number) => MARGIN + u * (size.width - 2 * MARGIN), [size]);
  const triY = useCallback((v: number) => MARGIN + v * (size.height - 2 * MARGIN), [size]);

  const projectOf = useCallback(
    (p: Person): { cx: number; cy: number } => {
      // people without domain shares stay parked at their cartesian spot
      // and just fade out (below) instead of flying to a shared (0,0)
      // corner — keeps the transition legible instead of a pile-up.
      if (state.mapMode === "domains" && hasShares(p)) {
        const { ux, uy } = ternaryUnit(p);
        return { cx: triX(ux), cy: triY(uy) };
      }
      return { cx: xScale(p.x), cy: yScale(p.y) };
    },
    [state.mapMode, xScale, yScale, triX, triY],
  );

  const radiusScale = useMemo(() => {
    if (state.glassesMode === "constant") return () => 4;
    const metricOf = (p: Person) => emphasisMetricOf(state.glassesMode, p);
    const domainMax = max(people, metricOf) ?? 1;
    const scale = scaleSqrt().domain([0, domainMax || 1]).range([3, 15]);
    return (p: Person) => scale(metricOf(p));
  }, [state.glassesMode, people]);

  const intensityScale = useMemo(() => {
    if (state.glassesMode === "constant") return () => 1;
    const metricOf = (p: Person) => emphasisMetricOf(state.glassesMode, p);
    const domainMax = max(people, metricOf) ?? 1;
    const scale = scaleLinear().domain([0, domainMax || 1]).range([0.35, 1]);
    return (p: Person) => scale(metricOf(p));
  }, [state.glassesMode, people]);

  // ---- Boxplot aggregation: only meaningful in Cartesian; the Rail can
  // still leave aggMode==="boxplot" transiently while mapMode briefly
  // disagrees during a mode-switch, so guard defensively rather than bin.
  const boxplotActive = state.aggMode === "boxplot" && state.mapMode === "cartesian";
  const boxBins = useMemo(() => {
    if (!boxplotActive) return null;
    const horiz = state.boxOrient === "h";
    const binCount = horiz ? BOX_ROWS : BOX_COLS;
    const scale = horiz ? yScale : xScale;
    const dom = scale.domain();
    const binDomain: [number, number] = [dom[0], dom[1]];
    const binValueOf = horiz ? (p: Person) => p.y : (p: Person) => p.x;
    const summaryValueOf = horiz ? (p: Person) => p.x : (p: Person) => p.y;
    return computeBoxBins(people, binValueOf, summaryValueOf, binDomain, binCount);
  }, [boxplotActive, state.boxOrient, people, xScale, yScale]);

  // ---- Hex density aggregation: Domains-only (see aggModeAllowed). Bins
  // every person's already-projected screen position (same projectOf used
  // for normal points), so it follows the ternary projection.
  const hexActive = state.aggMode === "hexdensity";
  const hexLayer = useMemo(() => {
    if (!hexActive) return null;
    const plotWidthPx = size.width - 2 * MARGIN;
    const r = hexRadius(plotWidthPx);
    const items = people
      .filter((p) => state.mapMode !== "domains" || hasShares(p))
      .map((p) => {
        const { cx, cy } = projectOf(p);
        const colorRgb: [number, number, number] =
          state.mapMode === "domains" ? cssRgbToTuple(domainColorOf(p)) : [0, 0, 0];
        return { cx, cy, colorRgb };
      });
    const cells = hexbinCells(items, r);
    const maxCount = max(cells, (c) => c.count) ?? 1;
    return { cells, maxCount, path: hexagonPath(r) };
  }, [hexActive, state.mapMode, people, projectOf, size.width]);

  // ---- Clusters aggregation: Domains-only. Recolors every shared person
  // to their SOLID dominant-domain hue and force-packs them into three
  // loose bubbles centered on the ternary triangle's corners. Guarded
  // defensively against mapMode per the SET_MAP reducer note above.
  const clustersActive = state.aggMode === "clusters" && state.mapMode === "domains";

  const vennCenters = useMemo<Record<DomainKey, { x: number; y: number }>>(() => {
    return {
      sensing: { x: triX(TRI.A[0]), y: triY(TRI.A[1]) },
      communication: { x: triX(TRI.B[0]), y: triY(TRI.B[1]) },
      computing: { x: triX(TRI.C[0]), y: triY(TRI.C[1]) },
    };
  }, [triX, triY]);

  const vennCentroid = useMemo(() => {
    const corners = Object.values(vennCenters);
    return {
      x: corners.reduce((s, c) => s + c.x, 0) / corners.length,
      y: corners.reduce((s, c) => s + c.y, 0) / corners.length,
    };
  }, [vennCenters]);

  // Domain corner labels (SENSING/COMMUNICATION/COMPUTING), positioned from
  // the SAME vennCenters/vennCentroid the triangle chrome and cluster foci
  // already use — not independent CSS percentages, which drift out of sync
  // with the actual vertex position as the window resizes (a fixed-px
  // MARGIN means a vertex's position as a fraction of width isn't constant
  // across sizes). Nudged outward from centroid->corner so they sit close
  // to their vertex without overlapping it.
  const domainLabelPos = useMemo(() => {
    const OFFSET = 20;
    return (["sensing", "communication", "computing"] as const).map((key) => {
      const c = vennCenters[key];
      const dx = c.x - vennCentroid.x;
      const dy = c.y - vennCentroid.y;
      const len = Math.hypot(dx, dy) || 1;
      return { label: key.toUpperCase(), x: c.x + (dx / len) * OFFSET, y: c.y + (dy / len) * OFFSET };
    });
  }, [vennCenters, vennCentroid]);

  // Live-updated every render so the sim-start effect (keyed narrowly on
  // clustersActive/people, see below) can seed from the CURRENT projection
  // and radius scale without needing them in its dependency array — the
  // same "read latest via ref, react to a narrow trigger" shape used
  // elsewhere for imperative external state (d3-zoom above).
  interface ClusterSeed {
    people: Person[];
    projectOf: (p: Person) => { cx: number; cy: number };
    radiusScale: (p: Person) => number;
    vennCenters: Record<DomainKey, { x: number; y: number }>;
    vennCentroid: { x: number; y: number };
  }
  const clusterSeedRef = useRef<ClusterSeed>({
    people,
    projectOf,
    radiusScale,
    vennCenters,
    vennCentroid,
  });
  // Refs must not be written during render — update it in an effect that
  // runs after every commit instead (no dep array), so it's still current
  // by the time the narrowly-keyed sim-start effect below reads it.
  useEffect(() => {
    clusterSeedRef.current = { people, projectOf, radiusScale, vennCenters, vennCentroid };
  });

  interface ClusterNode extends SimulationNodeDatum {
    id: string;
    r: number;
    dominantDomain: DomainKey;
    // Set for someone straddling two domains (see boundaryPairOf) — their
    // own focus becomes the midpoint of both foci instead of just their
    // (near-arbitrary) argmax domain, so they settle between the two
    // clusters they actually belong to rather than snapping fully into one.
    boundaryPair: [DomainKey, DomainKey] | null;
  }

  const [clusterPositions, setClusterPositions] = useState<Map<
    string,
    { x: number; y: number }
  > | null>(null);
  const clusterSimRef = useRef<Simulation<ClusterNode, undefined> | null>(null);

  useEffect(() => {
    if (!clustersActive) {
      clusterSimRef.current?.stop();
      clusterSimRef.current = null;
      setClusterPositions(null);
      return;
    }

    const seed = clusterSeedRef.current;
    const nodes: ClusterNode[] = [];
    for (const p of seed.people) {
      const dom = dominantDomainOf(p);
      if (!dom) continue; // no share data: excluded from the sim entirely
      const { cx, cy } = seed.projectOf(p);
      nodes.push({
        id: p.id,
        x: cx,
        y: cy,
        r: seed.radiusScale(p) * CLUSTER_COLLIDE_BOOST,
        dominantDomain: dom,
        boundaryPair: boundaryPairOf(p),
      });
    }

    const centers = seed.vennCenters;
    const centroid = seed.vennCentroid;
    // Cluster foci sit PARTWAY from the centroid to each actual corner
    // (0 = all three collapse to the centroid, 1 = right at the corner,
    // same as the triangle chrome/labels) — pulling the three lobes in
    // closer to the middle of the plot instead of hugging the edges.
    const FOCUS_T = 0.4;
    const foci: Record<DomainKey, { x: number; y: number }> = {
      sensing: {
        x: centroid.x + (centers.sensing.x - centroid.x) * FOCUS_T,
        y: centroid.y + (centers.sensing.y - centroid.y) * FOCUS_T,
      },
      communication: {
        x: centroid.x + (centers.communication.x - centroid.x) * FOCUS_T,
        y: centroid.y + (centers.communication.y - centroid.y) * FOCUS_T,
      },
      computing: {
        x: centroid.x + (centers.computing.x - centroid.x) * FOCUS_T,
        y: centroid.y + (centers.computing.y - centroid.y) * FOCUS_T,
      },
    };

    const publishPositions = () => {
      setClusterPositions(new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
    };

    // A boundary person's own focus is the midpoint of BOTH domains they
    // straddle, not just whichever one happened to win the (near-tied)
    // argmax — otherwise they snap fully into one lobe and read as
    // misplaced relative to their actual (mixed) domain mix.
    const focusOf = (n: ClusterNode): { x: number; y: number } => {
      if (n.boundaryPair) {
        const [a, b] = n.boundaryPair;
        return { x: (foci[a].x + foci[b].x) / 2, y: (foci[a].y + foci[b].y) / 2 };
      }
      return foci[n.dominantDomain];
    };

    const sim = forceSimulation<ClusterNode>(nodes)
      .alpha(0.7)
      .alphaDecay(0.05)
      .velocityDecay(0.62)
      .force("x", forceX<ClusterNode>((n) => focusOf(n).x).strength(0.12))
      .force("y", forceY<ClusterNode>((n) => focusOf(n).y).strength(0.12))
      // centering pull kept WEAKER than the domain foci so the three-lobe
      // shape survives.
      .force("cx", forceX<ClusterNode>(() => centroid.x).strength(0.03))
      .force("cy", forceY<ClusterNode>(() => centroid.y).strength(0.03))
      .force("charge", forceManyBody<ClusterNode>().strength(-3))
      .force("collide", forceCollide<ClusterNode>((n) => n.r + 1.5).strength(0.85).iterations(2))
      .stop();

    // silent warm-up: run ticks before the first paint so entry doesn't
    // read as a visible jumbled overlap resolving itself.
    for (let i = 0; i < 12; i++) sim.tick();
    publishPositions();

    sim.on("tick", publishPositions);
    sim.restart();
    clusterSimRef.current = sim;

    return () => {
      sim.stop();
    };
    // size.width/height: the domain-mix per-point view re-projects every
    // person fresh each render, so it naturally tracks a resize — but the
    // cluster sim's foci are baked into its forces at creation time, so
    // without these in the deps it keeps pulling toward the PRE-resize
    // triangle geometry until people/clustersActive happen to change too.
  }, [clustersActive, people, size.width, size.height]);

  // Cluster mode owns cx/cy directly via the ticking sim; everywhere else
  // (pin/zoom target) should read from it too while active so interaction
  // ---- Patents aggregation: Cartesian or Domains (see aggModeAllowed). A
  // d3-force overlay on top of the plain scatter (Domain mix's own ternary
  // projection in Domains, via the same projectOf everything else uses),
  // ported from SPRINT 13's vanilla-D3 enterPatents/exitPatents. Non-holders
  // are hidden entirely (see pointPeople below) rather than just faded, so
  // the wheel/plot only ever shows the people the satellites are attached
  // to. People with >=1 patent are PINNED (fx/fy) at their current position;
  // each real patent is a free node, keyed by its EPO id (person.patents,
  // from build_author_patents.py) so a patent shared by two on-screen
  // holders (real co-inventorship) collapses to one node instead of two. A
  // holder whose `patents` array is empty despite a nonzero total_patents (a
  // handful of counted patents have no matched per-record detail — see the
  // Person.patents doc) falls back to that many solo, unlinked synthetic
  // nodes rather than inventing fake coauthors.
  const patentsActive = state.aggMode === "patents" && (state.mapMode === "cartesian" || state.mapMode === "domains");
  const holders = useMemo(
    () =>
      patentsActive
        ? people.filter((p) => (p.total_patents || 0) > 0 && (state.mapMode !== "domains" || hasShares(p)))
        : [],
    [patentsActive, people, state.mapMode],
  );
  // Holders' own pinned positions, for the patent-link lines' person endpoint
  // — kept separate from the sim's internal copy (built fresh at sim setup,
  // not re-rendered) since this one needs to track live pan/zoom.
  const holderPositions = useMemo(
    () => new Map(holders.map((p) => [p.id, projectOf(p)])),
    [holders, projectOf],
  );

  interface PatentSimNode extends SimulationNodeDatum {
    id: string;
    kind: "person" | "patent";
    epoId?: string;
    title?: string;
    link?: string;
  }
  interface PatentGraphMeta {
    patents: { id: string; title?: string; link?: string }[];
    links: { source: string; target: string }[];
  }

  const patentSeedRef = useRef({ holders, projectOf });
  useEffect(() => {
    patentSeedRef.current = { holders, projectOf };
  });

  const [patentPositions, setPatentPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [patentGraph, setPatentGraph] = useState<PatentGraphMeta | null>(null);
  const patentSimRef = useRef<Simulation<PatentSimNode, SimulationLinkDatum<PatentSimNode>> | null>(null);

  useEffect(() => {
    if (!patentsActive) {
      patentSimRef.current?.stop();
      patentSimRef.current = null;
      setPatentPositions(null);
      setPatentGraph(null);
      return;
    }

    const seed = patentSeedRef.current;
    const peopleNodes: PatentSimNode[] = seed.holders.map((p) => {
      const { cx, cy } = seed.projectOf(p);
      return { id: p.id, kind: "person", fx: cx, fy: cy, x: cx, y: cy };
    });
    const peoplePos = new Map(peopleNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));

    const patentById = new Map<string, PatentSimNode>();
    const links: { source: string; target: string }[] = [];
    seed.holders.forEach((p) => {
      const anchor = peoplePos.get(p.id) ?? { x: 0, y: 0 };
      const patents = p.patents ?? [];
      if (patents.length) {
        patents.forEach((pt) => {
          const nodeId = `pat-${pt.epo_id}`;
          if (!patentById.has(nodeId)) {
            patentById.set(nodeId, {
              id: nodeId,
              kind: "patent",
              epoId: pt.epo_id,
              title: pt.title,
              link: pt.link,
              x: anchor.x,
              y: anchor.y,
            });
          }
          links.push({ source: nodeId, target: p.id });
        });
      } else {
        // no matched per-patent record for this holder -> fall back to solo
        // unlinked nodes, no fake coauthors.
        const count = p.total_patents || 0;
        for (let i = 0; i < count; i++) {
          const nodeId = `pat-${p.id}-${i}`;
          patentById.set(nodeId, { id: nodeId, kind: "patent", x: anchor.x, y: anchor.y });
          links.push({ source: nodeId, target: p.id });
        }
      }
    });
    const patentNodes = Array.from(patentById.values());
    const allNodes = peopleNodes.concat(patentNodes);

    const publish = () => {
      setPatentPositions(new Map(patentNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])));
    };
    setPatentGraph({ patents: patentNodes.map((n) => ({ id: n.id, title: n.title, link: n.link })), links });

    // forceLink MUTATES its input array in place, replacing each link's
    // string source/target with the actual node object once the sim ticks
    // — hand it its own shallow-cloned links so the plain-string version
    // above (what patentGraph/patentOwners/render key their Map.get()
    // lookups on) never gets silently turned into object references.
    const simLinks = links.map((l) => ({ ...l }));

    const sim = forceSimulation<PatentSimNode>(allNodes)
      .force(
        "link",
        forceLink<PatentSimNode, SimulationLinkDatum<PatentSimNode>>(simLinks)
          .id((n) => n.id)
          .distance(24)
          .strength(0.6),
      )
      .force("charge", forceManyBody<PatentSimNode>().strength(-16))
      .force("collide", forceCollide<PatentSimNode>((n) => (n.kind === "patent" ? 5 : 2)).strength(0.9))
      .stop();

    for (let i = 0; i < 12; i++) sim.tick();
    publish();
    sim.on("tick", publish);
    sim.restart();
    patentSimRef.current = sim;

    return () => {
      sim.stop();
    };
    // size.width/height: holders' pinned fx/fy come from projectOf, baked in
    // at sim creation — same resize-tracking reasoning as the cluster sim.
  }, [patentsActive, holders, size.width, size.height]);

  // ---- Universities aggregation: Cartesian or Domains (see aggModeAllowed).
  // Groups the current `people` by university and draws one bubble per
  // group instead of one point per person — mirrors GeoView's byUni/uniAgg/
  // rUni pattern (group -> aggregateGeo for the domain-mix rollup -> a
  // fresh count-based sqrt scale for radius), but positioned at the mean of
  // each member's already-projected screen position for the CURRENT
  // mapMode (projectOf), so it works for both Cartesian and Domains without
  // separate math per mode.
  const universitiesActive =
    state.aggMode === "universities" && (state.mapMode === "cartesian" || state.mapMode === "domains");

  interface UniBubble {
    university: string;
    cx: number;
    cy: number;
    count: number;
    fill: string;
  }

  const uniBubbles = useMemo<UniBubble[]>(() => {
    if (!universitiesActive) return [];
    const byUni = new Map<string, Person[]>();
    people.forEach((p) => {
      if (state.mapMode === "domains" && !hasShares(p)) return;
      if (!byUni.has(p.university)) byUni.set(p.university, []);
      byUni.get(p.university)!.push(p);
    });
    const groups = Array.from(byUni.entries()).map(([university, members]) => {
      let sx = 0;
      let sy = 0;
      members.forEach((p) => {
        const { cx, cy } = projectOf(p);
        sx += cx;
        sy += cy;
      });
      const agg = aggregateGeo(members);
      // Argmax over the group's paper-weighted domain-mix, same selection
      // dominantDomainOf uses per-person — coloured with the same vivid
      // per-domain palette the rest of Domains uses for consistency.
      const shares = agg.slices;
      const dom = (["sensing", "communication", "computing"] as const).reduce((best, k) =>
        shares[k] > shares[best] ? k : best,
      );
      return {
        university,
        cx: sx / members.length,
        cy: sy / members.length,
        count: members.length,
        fill: DOMAIN_COLORS_PRIMARY[dom],
      };
    });
    return groups;
  }, [universitiesActive, people, state.mapMode, projectOf]);

  const uniRadiusScale = useMemo(() => {
    const maxCount = max(uniBubbles, (g) => g.count) ?? 1;
    return scaleSqrt().domain([0, maxCount]).range([4, 26]);
  }, [uniBubbles]);

  const [hoveredUni, setHoveredUni] = useState<{ university: string; count: number; x: number; y: number } | null>(
    null,
  );

  // Pinning a person (a click) doesn't touch hoveredId — without this, the
  // patent highlight/dim goes dark the moment you pin someone, exactly when
  // you'd want it to stay put and let you inspect their satellites at
  // leisure. Same priority order the tooltip itself already uses.
  const highlightedHolderId = state.pinnedPersonId ?? hoveredId;

  // Which holders a given patent is linked to — hovering a person grays out
  // every patent NOT in their own set, so it reads as "these are theirs".
  const patentOwners = useMemo(() => {
    const m = new Map<string, Set<string>>();
    patentGraph?.links.forEach((l) => {
      const set = m.get(l.source) ?? new Set<string>();
      set.add(l.target);
      m.set(l.source, set);
    });
    return m;
  }, [patentGraph]);

  // Cluster mode owns cx/cy directly via the ticking sim; everywhere else
  // (pin/zoom target) should read from it too while active so interaction
  // targets match what's on screen.
  const positionOf = useCallback(
    (p: Person): { cx: number; cy: number } => {
      if (clustersActive) {
        const pos = clusterPositions?.get(p.id);
        if (pos) return { cx: pos.x, cy: pos.y };
      }
      return projectOf(p);
    },
    [clustersActive, clusterPositions, projectOf],
  );

  // per this overlay: raw per-point circles would be redundant clutter
  // once an aggregate glyph is showing for the same axis/projection. Hex
  // density is the exception — it crossfades with the point layer by zoom
  // level (see HEX_FADE_LO/HI) rather than hiding points outright — but only
  // once scoped down to a single university; at Nordics/country scope there
  // are too many people for the reveal to stay legible, so it's pinned at
  // hexFade=1 (hex fully opaque, points fully hidden — see the opacity math
  // below, NOT 0, which would make the hex layer itself invisible instead).
  const showPoints = !boxplotActive && !clustersActive && !universitiesActive;
  // Patents keeps the point layer (unlike Boxplot/Clusters, which replace it
  // outright) but narrows it to holders — everyone else fades out, same as
  // the vanilla app's non-holder fade.
  const pointPeople = patentsActive ? holders : people;
  const hexRevealsPoints = !isGeoScope(state.scope);
  const hexFade = !hexActive ? 0 : hexRevealsPoints ? hexFadeOpacity(transform.k) : 1;

  // ---- d3-zoom, attached imperatively; transform mirrored into React state
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 14])
      .on("zoom", (event) => setTransform(event.transform));
    zoomRef.current = z;
    const sel = select(svgRef.current);
    sel.call(z);
    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  const pinnedPerson = useMemo(
    () => (state.pinnedPersonId ? people.find((p) => p.id === state.pinnedPersonId) : null),
    [people, state.pinnedPersonId],
  );
  const hoveredPerson = useMemo(
    () => (hoveredId ? people.find((p) => p.id === hoveredId) : null),
    [people, hoveredId],
  );
  const displayedTooltipPerson = pinnedPerson ?? hoveredPerson ?? null;

  function unpin() {
    dispatch({ type: "SET_PINNED", id: null });
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
    }
  }

  function pinAndZoom(p: Person) {
    dispatch({ type: "SET_PINNED", id: p.id });
    if (!svgRef.current || !zoomRef.current) return;
    const { cx, cy } = positionOf(p);
    const k = 2.4;
    const tx = size.width / 2 - cx * k;
    const ty = size.height / 2 - cy * k;
    select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(k));
  }

  const ax = dataset.meta.axes;

  return (
    <div className="scatter-view" ref={containerRef}>
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        onClick={() => {
          if (state.pinnedPersonId) unpin();
        }}
      >
        {clustersActive && (
          <defs>
            {BOUNDARY_PAIRS.map(([a, b]) => (
              <pattern
                key={`${a}-${b}`}
                id={`zebra-${a}-${b}`}
                width="12"
                height="12"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="12" height="12" fill={DOMAIN_COLORS_PRIMARY[a]} />
                <rect width="6" height="12" fill={DOMAIN_COLORS_PRIMARY[b]} />
              </pattern>
            ))}
          </defs>
        )}
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {state.mapMode === "cartesian" ? (
            <g className="chrome">
              <line
                className="axis-cross"
                x1={MARGIN}
                x2={size.width - MARGIN}
                y1={yScale(0)}
                y2={yScale(0)}
              />
              <line
                className="axis-cross"
                x1={xScale(0)}
                x2={xScale(0)}
                y1={MARGIN}
                y2={size.height - MARGIN}
              />
            </g>
          ) : (
            <g className="chrome">
              <polygon
                className="tri-edge"
                points={`${vennCenters.sensing.x},${vennCenters.sensing.y} ${vennCenters.communication.x},${vennCenters.communication.y} ${vennCenters.computing.x},${vennCenters.computing.y}`}
              />
              <line className="axis-cross" x1={vennCentroid.x} y1={vennCentroid.y} x2={vennCenters.sensing.x} y2={vennCenters.sensing.y} />
              <line className="axis-cross" x1={vennCentroid.x} y1={vennCentroid.y} x2={vennCenters.communication.x} y2={vennCenters.communication.y} />
              <line className="axis-cross" x1={vennCentroid.x} y1={vennCentroid.y} x2={vennCenters.computing.x} y2={vennCenters.computing.y} />
            </g>
          )}

          {/* Rendered here (before the point layer) rather than alongside
              patent-nodes below, so the connecting lines sit BEHIND every
              circle — person points included — instead of drawing over
              them. */}
          {patentsActive && patentGraph && patentPositions && (
            <g className="patent-links">
              {patentGraph.links.map((l, i) => {
                const source = patentPositions.get(l.source);
                const target = holderPositions.get(l.target);
                if (!source || !target) return null;
                const owners = patentOwners.get(l.source);
                const dim = highlightedHolderId != null && !owners?.has(highlightedHolderId);
                return (
                  <line
                    key={i}
                    className={"pat-link" + (dim ? " dim" : "")}
                    x1={source.x}
                    y1={source.y}
                    x2={target.cx}
                    y2={target.cy}
                    strokeWidth={1 / transform.k}
                  />
                );
              })}
            </g>
          )}

          {showPoints &&
            pointPeople.map((p) => {
              const { cx, cy } = projectOf(p);
              const r = radiusScale(p);
              // in domains mode, a person without domain shares has nowhere
              // meaningful to sit — keep them mounted at their cartesian spot
              // (see projectOf) but faded out, so switching modes reads as a
              // flight + fade rather than points vanishing/appearing outright.
              const hiddenInDomains = state.mapMode === "domains" && !hasShares(p);
              // Hovering a patent fades every holder NOT linked to it — the
              // mirror of hovering a holder fading their unrelated patents.
              const patentHoverDim = patentsActive && hoveredPatent != null && !patentOwners.get(hoveredPatent.id)?.has(p.id);
              const hoverDim = (hoveredId != null && hoveredId !== p.id) || patentHoverDim;
              const searchDim = state.search.trim() !== "" && !matchesPersonSearch(p, state.search);
              let opacity = 0.88;
              if (hiddenInDomains) opacity = 0;
              else if (hoverDim) opacity *= 0.12;
              else if (searchDim) opacity *= 0.22;
              // hex density owns low zoom; points fade in as you zoom past
              // HEX_FADE_LO and fully own the view again past HEX_FADE_HI.
              if (hexActive) opacity *= 1 - hexFade;
              const fill =
                state.mapMode === "domains" ? domainColorOf(p) : "var(--point)";
              const fillOpacity = state.mapMode === "domains" ? 1 : intensityScale(p);
              const hexHidden = hexActive && hexFade >= 1;
              return (
                <circle
                  key={p.id}
                  cx={cx}
                  cy={cy}
                  r={r / transform.k}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  opacity={opacity}
                  style={{ pointerEvents: hiddenInDomains || hexHidden ? "none" : "auto" }}
                  className={"point" + (p.id === state.pinnedPersonId ? " pinned" : "")}
                  onMouseEnter={(e) => {
                    setHoveredId(p.id);
                    setHoverScreen({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseMove={(e) => setHoverScreen({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => {
                    setHoveredId(null);
                    setHoverScreen(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    pinAndZoom(p);
                  }}
                />
              );
            })}

          {clustersActive && clusterPositions && (
            <g className="agg-clusters">
              {people.filter(hasShares).map((p) => {
                const pos = clusterPositions.get(p.id);
                if (!pos) return null; // sim hasn't seeded this person yet
                const dom = dominantDomainOf(p);
                const boundary = boundaryPairOf(p);
                const fill = boundary
                  ? `url(#zebra-${boundary[0]}-${boundary[1]})`
                  : dom
                    ? DOMAIN_COLORS_PRIMARY[dom]
                    : "var(--point)";
                const r = radiusScale(p) * CLUSTER_R_BOOST;
                const hoverDim = hoveredId != null && hoveredId !== p.id;
                const searchDim = state.search.trim() !== "" && !matchesPersonSearch(p, state.search);
                let opacity = 0.88;
                if (hoverDim) opacity *= 0.12;
                else if (searchDim) opacity *= 0.22;
                return (
                  <circle
                    key={p.id}
                    cx={pos.x}
                    cy={pos.y}
                    r={r / transform.k}
                    fill={fill}
                    fillOpacity={1}
                    opacity={opacity}
                    // no-flight: the force sim owns cx/cy every tick, so the
                    // CSS position transition (used for the ternary flight)
                    // must not fight it here — leaving clusters drops this
                    // class and hands cx/cy back to projectOf + the transition.
                    className={"point no-flight" + (p.id === state.pinnedPersonId ? " pinned" : "")}
                    onMouseEnter={(e) => {
                      setHoveredId(p.id);
                      setHoverScreen({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseMove={(e) => setHoverScreen({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => {
                      setHoveredId(null);
                      setHoverScreen(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      pinAndZoom(p);
                    }}
                  />
                );
              })}
            </g>
          )}

          {patentsActive && patentGraph && patentPositions && (
            <g className="agg-patents">
              <g className="patent-nodes">
                {patentGraph.patents.map((pn) => {
                  const pos = patentPositions.get(pn.id);
                  if (!pos) return null;
                  const owners = patentOwners.get(pn.id);
                  // Hovering a holder fades every OTHER patent — hovering a
                  // patent fades holders instead (see pointPeople above) and
                  // leaves every other patent alone, just growing this one.
                  const dim = highlightedHolderId != null && !owners?.has(highlightedHolderId);
                  const isHovered = hoveredPatent?.id === pn.id;
                  return (
                    <circle
                      key={pn.id}
                      className={"pat" + (dim ? " dim" : "") + (isHovered ? " hovered" : "")}
                      cx={pos.x}
                      cy={pos.y}
                      r={(isHovered ? 5.5 : 3.5) / transform.k}
                      strokeWidth={1 / transform.k}
                      onMouseEnter={(e) => setHoveredPatent({ id: pn.id, title: pn.title, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setHoveredPatent((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                      onMouseLeave={() => setHoveredPatent(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (pn.link) window.open(pn.link, "_blank", "noopener,noreferrer");
                      }}
                    />
                  );
                })}
              </g>
            </g>
          )}

          {universitiesActive && (
            <g className="agg-universities">
              {uniBubbles.map((g) => (
                <circle
                  key={g.university}
                  cx={g.cx}
                  cy={g.cy}
                  r={uniRadiusScale(g.count) / transform.k}
                  fill={g.fill}
                  fillOpacity={0.75}
                  className="point"
                  onMouseEnter={(e) => setHoveredUni({ university: g.university, count: g.count, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHoveredUni((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
                  onMouseLeave={() => setHoveredUni(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "SET_SCOPE", scope: g.university });
                  }}
                />
              ))}
            </g>
          )}

          {boxBins && (
            <g className="agg-boxplot">
              {boxBins.map((bin) => {
                if (!bin) return null;
                const g = boxGeom(bin, state.boxOrient === "h", xScale, yScale);
                return (
                  <g key={bin.index}>
                    <line
                      className="box-whisker"
                      x1={g.whiskerLoX1}
                      y1={g.whiskerLoY1}
                      x2={g.whiskerLoX2}
                      y2={g.whiskerLoY2}
                      strokeWidth={1 / transform.k}
                    />
                    <line
                      className="box-whisker"
                      x1={g.whiskerHiX1}
                      y1={g.whiskerHiY1}
                      x2={g.whiskerHiX2}
                      y2={g.whiskerHiY2}
                      strokeWidth={1 / transform.k}
                    />
                    <line
                      className="box-whisker"
                      x1={g.capLoX1}
                      y1={g.capLoY1}
                      x2={g.capLoX2}
                      y2={g.capLoY2}
                      strokeWidth={1 / transform.k}
                    />
                    <line
                      className="box-whisker"
                      x1={g.capHiX1}
                      y1={g.capHiY1}
                      x2={g.capHiX2}
                      y2={g.capHiY2}
                      strokeWidth={1 / transform.k}
                    />
                    <rect
                      className="box-rect"
                      x={g.rectX}
                      y={g.rectY}
                      width={g.rectW}
                      height={g.rectH}
                      rx={3}
                      strokeWidth={1 / transform.k}
                    />
                    <line
                      className="box-median"
                      x1={g.medianX1}
                      y1={g.medianY1}
                      x2={g.medianX2}
                      y2={g.medianY2}
                      strokeWidth={2 / transform.k}
                    />
                    {g.outliers.map((o, i) => (
                      <circle
                        key={i}
                        className="box-outlier"
                        cx={o.x}
                        cy={o.y}
                        r={2.2 / transform.k}
                      />
                    ))}
                  </g>
                );
              })}
            </g>
          )}

          {hexLayer && (
            <g className="agg-hex">
              {hexLayer.cells.map((c) => {
                const alpha = hexAlpha(c.count, hexLayer.maxCount);
                const fill =
                  state.mapMode === "domains"
                    ? `rgb(${Math.round(c.sumR / c.count)}, ${Math.round(c.sumG / c.count)}, ${Math.round(c.sumB / c.count)})`
                    : "var(--point)";
                return (
                  <path
                    key={c.id}
                    className="hex"
                    d={hexLayer.path}
                    transform={`translate(${c.x},${c.y})`}
                    fill={fill}
                    fillOpacity={alpha * hexFade}
                    strokeWidth={1 / transform.k}
                  />
                );
              })}
            </g>
          )}
        </g>
      </svg>

      {state.mapMode === "cartesian" && (
        <div className="pole-labels">
          <div className="pole pole-top">{ax.y.pos.toUpperCase()}</div>
          <div className="pole pole-bottom">{ax.y.neg.toUpperCase()}</div>
          <div className="pole pole-left">{ax.x.neg.toUpperCase()}</div>
          <div className="pole pole-right">{ax.x.pos.toUpperCase()}</div>
        </div>
      )}
      {state.mapMode === "domains" && (
        <div className="pole-labels">
          {domainLabelPos.map((p) => (
            <div key={p.label} className="pole pole-tri" style={{ left: p.x, top: p.y }}>
              {p.label}
            </div>
          ))}
        </div>
      )}

      {clustersActive && (
        <div className="domain-legend">
          <div className="legend-head">Domains · Primary domain</div>
          <div className="legend-caption">
            emphasis: {EMPHASIS_LABEL[state.glassesMode] ?? state.glassesMode} · colour: Primary domain + boundary
            stripes · representation: Primary domain
          </div>
          <div className="legend-swatches">
            <span className="legend-row">
              <i className="legend-swatch" style={{ background: DOMAIN_COLORS_PRIMARY.sensing }} />
              Sensing
            </span>
            <span className="legend-row">
              <i className="legend-swatch" style={{ background: DOMAIN_COLORS_PRIMARY.communication }} />
              Communication
            </span>
            <span className="legend-row">
              <i className="legend-swatch" style={{ background: DOMAIN_COLORS_PRIMARY.computing }} />
              Computing
            </span>
            <span className="legend-row">
              <i className="legend-swatch legend-swatch-zebra" />
              Boundary
            </span>
          </div>
        </div>
      )}

      {patentsActive && patentGraph && (
        <div className="domain-legend">
          <div className="legend-head">Patents</div>
          <div className="legend-caption">
            {holders.length} holder{holders.length === 1 ? "" : "s"} · {patentGraph.patents.length} patent
            {patentGraph.patents.length === 1 ? "" : "s"}
          </div>
        </div>
      )}

      {displayedTooltipPerson &&
        (pinnedPerson ? (
          <Tooltip
            person={pinnedPerson}
            x={size.width / 2}
            y={size.height / 2 - 100}
            pinned
            onClose={unpin}
            patentLinks={patentLinks}
            collaborations={collaborations}
            knownPersonIds={knownPersonIds}
            onPinPerson={(id) => {
              const p = dataset.people.find((pp) => pp.id === id);
              if (!p) return;
              if (p.university !== state.scope) dispatch({ type: "SET_SCOPE", scope: p.university });
              pinAndZoom(p);
            }}
          />
        ) : (
          hoveredPerson &&
          hoverScreen && (
            <Tooltip
              person={hoveredPerson}
              x={hoverScreen.x}
              y={hoverScreen.y}
              pinned={false}
              patentLinks={patentLinks}
              collaborations={collaborations}
              knownPersonIds={knownPersonIds}
              onPinPerson={(id) => {
                const p = dataset.people.find((pp) => pp.id === id);
                if (!p) return;
                if (p.university !== state.scope) dispatch({ type: "SET_SCOPE", scope: p.university });
                pinAndZoom(p);
              }}
            />
          )
        ))}

      {hoveredPatent && (
        <div className="pat-tooltip" style={{ left: hoveredPatent.x + 14, top: hoveredPatent.y + 14 }}>
          {hoveredPatent.title || "Untitled patent"}
        </div>
      )}

      {hoveredUni && (
        <div className="pat-tooltip" style={{ left: hoveredUni.x + 14, top: hoveredUni.y + 14 }}>
          {hoveredUni.university} · {hoveredUni.count} {hoveredUni.count === 1 ? "person" : "people"}
        </div>
      )}
    </div>
  );
}
