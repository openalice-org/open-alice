import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { hasUmap, type PersonPaper } from "../../lib/personPapers";
import { buildRoots } from "../../lib/roots";
import { DOMAIN_COLORS, DOMAIN_COLORS_VIVID } from "../../lib/ternary";

export type PaperSizeMetric = "constant" | "citations" | "coauthors";

/** Every paper as a dot, or one node per year joined into a path. */
export type CubeMode = "papers" | "trajectory";

/** What the floor plane means: the domain triangle, or a UMAP of paper embeddings (topics). */
export type CubeSpace = "triangle" | "umap";

/** Topics space framing, chosen per person so their papers fill the stage. */
export interface UmapFrame {
  cx: number;
  cy: number;
  scale: number;
}

interface PaperCubeProps {
  papers: PersonPaper[]; // already year-filtered by the parent
  yearMin: number;
  yearMax: number;
  sizeBy: PaperSizeMetric;
  selectedWid: number | null;
  onSelect: (wid: number | null) => void;
  mode: CubeMode;
  space: CubeSpace;
  /** Topics space: which UMAP point (0..1) sits on the vertical axis, and how many world units a UMAP unit spans. */
  frame: UmapFrame;
  /** Trajectory mode: keep the individual papers visible as faint context. */
  ghost: boolean;
  /** Trajectory mode: the papers the roots grow through (already year-filtered), oldest first. */
  highlights: PersonPaper[];
  /** Bump `n` to send the camera to the default view (n=0 applies instantly on mount). */
  view: { n: number };
}

// World units. The ternary triangle is SIDE wide; time runs up the Y axis over HEIGHT.
const SIDE = 10;
const HEIGHT = 10;
const R_MIN = 0.09;
const R_MAX = 0.42;
const GHOST_SCALE = 0.5; // paper icons shrink to this fraction behind the roots
const GHOST_ALPHA = 0.28;
const HIGHLIGHT_SCALE = 1.3; // highlight pages are a little bigger than the ghosts behind them
const HIGHLIGHT_TINT = 0.8; // and lean harder toward their domain colour
const GROW_SECONDS = 2.2; // the roots take this long to climb the whole axis
const ROOT_R_MIN = 0.02; // twig and trunk radii (world units)
const ROOT_R_MAX = 0.1;
const ROOT_STEPS = 22; // samples along each branch
const ICON_HEIGHT = 1.9; // paper icon height as a multiple of the old dot radius
const ICON_ASPECT = 0.64; // paper icon width / height
const ICON_ALPHA = 0.85; // overlapping pages show through each other a little
const PAPER_GREY = new THREE.Color(0xbfc0be); // the lab view's flat grey page
const PAPER_TINT = 0.35; // how far a page leans toward its domain colour (0 = plain grey, 1 = full colour)
const INK = 0x181816;
const SERIF = "'EB Garamond', Georgia, 'Times New Roman', serif";

// Saturated "toon" versions of the domain colours.
const cA = new THREE.Color(DOMAIN_COLORS_VIVID.sensing);
const cB = new THREE.Color(DOMAIN_COLORS_VIVID.communication);
const cC = new THREE.Color(DOMAIN_COLORS_VIVID.computing);

// Equilateral triangle centred on the origin: Sensing at the far apex (-z), Communication
// bottom-left, Computing bottom-right. (The app's flat ternary uses a stretched triangle;
// here all three sides are the same length.)
const RAD = SIDE / Math.sqrt(3);
type XZ = [number, number];
const CORNERS: { A: XZ; B: XZ; C: XZ } = {
  A: [0, -RAD],
  B: [-SIDE / 2, RAD / 2],
  C: [SIDE / 2, RAD / 2],
};
function pointXZ(p: { sensing: number; communication: number; computing: number }): XZ {
  const { A, B, C } = CORNERS;
  return [
    p.sensing * A[0] + p.communication * B[0] + p.computing * C[0],
    p.sensing * A[1] + p.communication * B[1] + p.computing * C[1],
  ];
}

// UMAP space has no box: papers float around a vertical time axis through the frame's centre.
// Papers far from the cloud are pulled in softly (never past MAX_R) so a stray paper can't fly off the stage.
const CORE_R = 3.2;
const MAX_R = 4.6;
function umapXZ(p: { ux: number; uy: number }, f: UmapFrame): XZ {
  const x = (p.ux - f.cx) * f.scale;
  const z = (p.uy - f.cy) * f.scale;
  const r = Math.hypot(x, z);
  if (r <= CORE_R) return [x, z];
  const k = (CORE_R + (MAX_R - CORE_R) * Math.tanh((r - CORE_R) / (MAX_R - CORE_R))) / r;
  return [x * k, z * k];
}
const GROUND_RADIUS = 6.5; // the soft ground gradient under the Topics cloud

/** Footprint of the triangle prism, in order around its edge. */
const TRIANGLE: XZ[] = [CORNERS.A, CORNERS.B, CORNERS.C];

interface Face {
  mx: number;
  mz: number;
  nx: number;
  nz: number;
}

/** One entry per side face: its midpoint and outward normal (the footprint is centred on the origin). */
function facesOf(space: CubeSpace): Face[] {
  if (space === "umap") return []; // no faces: the year labels sit on the axis instead
  return TRIANGLE.map((p, i) => {
    const q = TRIANGLE[(i + 1) % TRIANGLE.length];
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    const len = Math.hypot(mx, mz) || 1;
    return { mx, mz, nx: mx / len, nz: mz / len };
  });
}

function paperXZ(space: CubeSpace, p: PersonPaper, f: UmapFrame): XZ {
  return space === "umap" && hasUmap(p) ? umapXZ(p, f) : pointXZ(p);
}

/** Where a paper sits: its space position on the floor plane, and its year up the axis (with a small
 * deterministic jitter so same-year papers do not stack in one column). */
function paperPoint(space: CubeSpace, p: PersonPaper, f: UmapFrame, yearMin: number, yearMax: number): [number, number, number] {
  const [x, z] = paperXZ(space, p, f);
  const span = Math.max(1, yearMax - yearMin);
  const jitter = ((p.wid % 997) / 997 - 0.5) * (HEIGHT / span) * 0.6;
  const y = Math.min(HEIGHT, Math.max(0, ((p.year - yearMin) / span) * HEIGHT + jitter));
  return [x, y, z];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TARGET = new THREE.Vector3(0, HEIGHT / 2, 0);
// a touch further back than a tight fit, so corner labels and the year chips have room
const HOME = { offset: new THREE.Vector3(19, 7.5, 21.5), fov: 40 };

/** Editorial label: letterspaced serif caps, no box. Optional paper halo keeps it legible over dots. */
function labelSprite(text: string, color: string, scale = 1, italic = false): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1280; // 2x so thin serif strokes survive minification
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  let px = 108;
  const label = italic ? text : text.toUpperCase();
  const setFont = () => {
    ctx.font = `${italic ? "italic " : ""}600 ${px}px ${SERIF}`;
    ctx.letterSpacing = italic ? "0px" : `${Math.round(px * 0.14)}px`;
  };
  setFont();
  const natural = ctx.measureText(label).width;
  if (natural > 1200) {
    px = Math.floor((px * 1200) / natural);
    setFont();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  ctx.strokeStyle = "rgba(251,251,249,0.92)"; // --paper halo
  ctx.strokeText(label, 640, 132);
  ctx.fillStyle = color;
  ctx.fillText(label, 640, 132);
  if (!italic) {
    // faux-bold: Garamond caps are hairline-thin once the texture is minified
    ctx.lineWidth = 5;
    ctx.strokeStyle = color;
    ctx.strokeText(label, 640, 132);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(4 * scale, 0.8 * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Year tick: dark italic serif on a flat white box, no stroke or rounding (reads on any backdrop). */
function chipSprite(text: string, worldHeight = 0.5): THREE.Sprite {
  const H = 96;
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = `italic 600 56px ${SERIF}`;
  probe.font = font;
  const W = Math.ceil(probe.measureText(text).width) + 44;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#181816";
  ctx.fillText(text, W / 2, H / 2 + 3);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((W / H) * worldHeight, worldHeight, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Hairline cylinder between two points (gives lines a consistent, crisp weight). */
function bar(p1: THREE.Vector3, p2: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8, 1), mat);
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** Soft 4-step cel ramp (min 0.77): reads as shaded print, not cartoon. */
function toonRamp(): THREE.DataTexture {
  const steps = [196, 224, 244, 255]; // gentle cel steps: shaded, not cartoonish
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function sizeValue(p: PersonPaper, metric: PaperSizeMetric): number {
  if (metric === "citations") return Math.log1p(p.citations);
  if (metric === "coauthors") return Math.log1p(Math.max(0, p.authors - 1));
  return 1;
}

const TUBE_SIDES = 10;

interface SplineSample {
  p: THREE.Vector3;
  /** Which stretch (node i -> i+1) this sample lies on, and how far along it (0..1). */
  seg: number;
  u: number;
}

/** Toon material for the root tubes: the surface is `position + offset * uK`, where `uK` follows the zoom
 * (see zoomK), so the lines keep the same thickness on screen when you zoom. */
function rootMaterial(ramp: THREE.DataTexture, uK: { value: number }): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ gradientMap: ramp, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uK = uK;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 offset;\nuniform float uK;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + offset * uK;');
  };
  m.customProgramCacheKey = () => "root-tube";
  return m;
}

/**
 * A smooth tube along the samples with a per-sample radius and colour (parallel-transport
 * frames, so it never twists). One mesh, one draw call, smooth shading. The surface is the centre
 * line plus the `offset` attribute, so it needs `rootMaterial` (which applies the zoom scale).
 */
function tubeAlong(
  samples: SplineSample[],
  radiusAt: (s: SplineSample) => number,
  colorAt: (s: SplineSample) => THREE.Color,
  material: THREE.Material,
): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array(n * TUBE_SIDES * 3); // the centre line, repeated for each side
  const offsets = new Float32Array(n * TUBE_SIDES * 3); // from the centre line out to the surface (scaled by zoom in the shader)
  const normals = new Float32Array(n * TUBE_SIDES * 3);
  const colors = new Float32Array(n * TUBE_SIDES * 3);
  const tangent = new THREE.Vector3();
  const prevT = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let k = 0; k < n; k++) {
    tangent.subVectors(samples[Math.min(n - 1, k + 1)].p, samples[Math.max(0, k - 1)].p).normalize();
    if (k === 0) {
      // any vector not parallel to the first tangent seeds the frame
      const ref = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      normal.crossVectors(tangent, ref).normalize();
    } else {
      normal.applyQuaternion(q.setFromUnitVectors(prevT, tangent));
    }
    binormal.crossVectors(tangent, normal).normalize();
    prevT.copy(tangent);
    const r = radiusAt(samples[k]);
    const c = colorAt(samples[k]);
    for (let j = 0; j < TUBE_SIDES; j++) {
      const a = (j / TUBE_SIDES) * Math.PI * 2;
      dir.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
      const o = (k * TUBE_SIDES + j) * 3;
      positions[o] = samples[k].p.x;
      positions[o + 1] = samples[k].p.y;
      positions[o + 2] = samples[k].p.z;
      offsets[o] = dir.x * r;
      offsets[o + 1] = dir.y * r;
      offsets[o + 2] = dir.z * r;
      normals[o] = dir.x;
      normals[o + 1] = dir.y;
      normals[o + 2] = dir.z;
      colors[o] = c.r;
      colors[o + 1] = c.g;
      colors[o + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < TUBE_SIDES; j++) {
      const a = k * TUBE_SIDES + j;
      const b = k * TUBE_SIDES + ((j + 1) % TUBE_SIDES);
      const c = (k + 1) * TUBE_SIDES + j;
      const d = (k + 1) * TUBE_SIDES + ((j + 1) % TUBE_SIDES);
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("offset", new THREE.BufferAttribute(offsets, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  return new THREE.Mesh(geo, material);
}

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const step = [1, 2, 5, 10, 20].find((s) => span / s <= 7) ?? 20;
  const first = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let y = first; y <= hi; y += step) ticks.push(y);
  if (!ticks.includes(lo) && ticks[0] - lo >= step / 2) ticks.unshift(lo);
  return ticks.length ? ticks : [lo, hi];
}

/** A plain page with a small folded corner (the Simplified look of the lab view). White, so the
 * instance colour sets the page colour; the fold is a slightly darker shade of it. */
function paperTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 150; // 0.64 aspect, like the lab icons
  const ctx = c.getContext("2d")!;
  const [l, t, r, b, fold] = [5, 5, 91, 145, 28];
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(l, t);
  ctx.lineTo(r - fold, t);
  ctx.lineTo(r, t + fold);
  ctx.lineTo(r, b);
  ctx.lineTo(l, b);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(90,90,88,0.45)";
  ctx.stroke();
  // folded corner
  ctx.beginPath();
  ctx.moveTo(r - fold, t);
  ctx.lineTo(r - fold, t + fold);
  ctx.lineTo(r, t + fold);
  ctx.closePath();
  ctx.fillStyle = "#e0e0de";
  ctx.fill();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Per-paper icon placement, kept so the icons can be re-aimed at the camera whenever it moves. */
interface IconData {
  pos: Float32Array; // x, y, z per icon
  w: Float32Array;
  h: Float32Array;
  /** 0..1 grow-in factor per icon (1 = full size); animations drive it. */
  k: Float32Array;
}

// Icons keep the same on-screen size whatever the zoom: their world size is scaled by the camera's
// distance to the target (and its field of view), normalised to the default 3/4 view (distance ~28.7, fov 40).
const ICON_REF_SCALE = 28.7 * Math.tan(THREE.MathUtils.degToRad(40) / 2);

/** 1 at the default view; grows as the camera moves away or widens its field of view. Multiplying a
 * world size by this keeps it the same size on screen whatever the zoom. */
function zoomK(camera: THREE.PerspectiveCamera, target: THREE.Vector3): number {
  return (camera.position.distanceTo(target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / ICON_REF_SCALE;
}

function placeIcons(mesh: THREE.InstancedMesh, d: IconData, camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  const k = zoomK(camera, target);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (let i = 0; i < d.w.length; i++) {
    p.set(d.pos[3 * i], d.pos[3 * i + 1], d.pos[3 * i + 2]);
    sc.set(d.w[i] * k * d.k[i], d.h[i] * k * d.k[i], 1);
    m.compose(p, camera.quaternion, sc);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere(); // icon size changed, so culling and picking need fresh bounds
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
      (x as THREE.SpriteMaterial).map?.dispose?.();
      x.dispose();
    });
  });
}

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  chrome: THREE.Group;
  dots: THREE.Group;
  ramp: THREE.DataTexture;
  /** The pickable (front) instanced mesh inside `dots`. */
  points: THREE.InstancedMesh | null;
  /** Where each paper icon goes (null when none are drawn). */
  icons: IconData | null;
  paperTex: THREE.CanvasTexture;
  /** Trajectory highlight icons (pickable) and the group holding them + the roots. */
  nodes: THREE.InstancedMesh | null;
  traj: THREE.Group;
  halo: THREE.Sprite;
  render: () => void;
  /** Materials that fade as the camera rises toward a top-down view (set by the dots effect). */
  /** Crossfade the year chips between faces, and fade the dots, for the current camera angle. */
  syncView: () => void;
  /** Switch which footprint the year chips are arranged around (call before the chrome is rebuilt). */
  setSpace: (space: CubeSpace) => void;
  /** Which space the axes/frame currently drawn belong to, and how opaque they are (fades during a morph). */
  chromeSpace: CubeSpace;
  chromeAlpha: number;
  /** Which space the paper icons were last laid out for, and where they ended up (by work id). */
  dotsSpace: CubeSpace;
  posByWid: Map<number, [number, number, number]>;
  /** False until the papers have appeared once (that first appearance is animated). */
  introDone: boolean;
  years: [number, number];
  anim: Anim | null;
  /** Trajectory mode: the highlight icons (also `nodes`, the pickable mesh), the root growth in progress,
   * and a function that replays the growth. `trajMode` is the mode the trajectory was last built for. */
  hIcons: IconData | null;
  /** Zoom scale applied to the root tubes' thickness (a shader uniform). */
  rootK: { value: number };
  growth: Growth | null;
  regrow: (() => void) | null;
  trajMode: CubeMode;
}

// ---- animations ------------------------------------------------------------------------------------
// Papers appear, and move between spaces, in time order: oldest (bottom) first, newest (top) last.
const STAGGER = 0.75; // s between the bottom and the top paper starting
const PAPER_DUR = 0.55; // s each paper takes
const FADE_OUT = 0.25; // s the old axes take to disappear once the papers have settled
const FADE_IN = 0.35; // s the new axes take to appear

interface Anim {
  kind: "intro" | "morph";
  t0: number;
  from: Float32Array;
  to: Float32Array;
  /** Morph: 1 for papers that had no position in the old space (they grow in place instead). */
  popIn: Uint8Array;
  /** Seconds each paper waits before it starts (by height). */
  delay: Float32Array;
  /** When the last paper lands. */
  tPapers: number;
  space: CubeSpace;
  swapped: boolean;
  shadow: THREE.InstancedMesh | null;
}

const unit = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOutBack = (p: number) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

/** Apply `s.chromeAlpha` to everything in the chrome (the triangle's year chips follow it in syncView). */
function applyChromeAlpha(s: Scene3D) {
  s.chrome.traverse((o) => {
    if (o.userData.face !== undefined) return;
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (m.userData.baseOpacity === undefined) {
        m.userData.baseOpacity = m.opacity;
        m.userData.baseTransparent = m.transparent;
      }
      m.transparent = s.chromeAlpha < 1 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * s.chromeAlpha;
    }
  });
}

/** Land everything: final positions and sizes, axes fully shown, trajectory back, shadows in. */
function finishAnim(s: Scene3D) {
  const a = s.anim;
  if (!a) return;
  if (s.icons) {
    s.icons.pos.set(a.to);
    s.icons.k.fill(1);
  }
  if (s.chromeSpace !== a.space) buildChrome(s, a.space, s.years[0], s.years[1]);
  s.chromeAlpha = 1;
  applyChromeAlpha(s);
  s.traj.visible = true;
  if (a.shadow) s.dots.add(a.shadow);
  s.anim = null;
  if (a.kind === "morph") s.regrow?.(); // the roots grow again in the new space
}

/** Advance the running animation to `now`. Returns true while it still has work to do. */
function stepAnim(s: Scene3D, now: number): boolean {
  const a = s.anim;
  const d = s.icons;
  if (!a || !d) {
    finishAnim(s);
    return false;
  }
  const t = (now - a.t0) / 1000;
  let landed = true;
  for (let i = 0; i < d.w.length; i++) {
    const p = unit((t - a.delay[i]) / PAPER_DUR);
    if (p < 1) landed = false;
    if (a.kind === "morph") {
      const e = easeInOut(p);
      for (let c = 0; c < 3; c++) d.pos[3 * i + c] = a.from[3 * i + c] + (a.to[3 * i + c] - a.from[3 * i + c]) * e;
      d.k[i] = a.popIn[i] ? easeOutBack(p) : 1;
    } else {
      d.k[i] = easeOutBack(p);
    }
  }
  if (!landed) return true;
  if (a.kind === "intro") {
    finishAnim(s);
    return false;
  }
  // morph, papers landed: the old axes fade out, then the new ones fade in
  const tc = t - a.tPapers;
  if (tc < FADE_OUT) {
    s.chromeAlpha = 1 - unit(tc / FADE_OUT);
  } else {
    if (!a.swapped) {
      s.chromeAlpha = 0;
      buildChrome(s, a.space, s.years[0], s.years[1]);
      a.swapped = true;
    }
    s.chromeAlpha = unit((tc - FADE_OUT) / FADE_IN);
  }
  applyChromeAlpha(s);
  if (tc >= FADE_OUT + FADE_IN) {
    finishAnim(s);
    return false;
  }
  return true;
}

// ---- roots growth ---------------------------------------------------------------------------------
interface Growth {
  t0: number;
  /** One tube per branch: how many segments it has, and the height span it grows across. */
  edges: { geo: THREE.BufferGeometry; segs: number; yp: number; dy: number }[];
  /** Height of each highlight page, which pops in when the growing tip reaches it. */
  ys: Float32Array;
}

/** Show the roots up to height `h` (Infinity = all of it): branches draw out from their parent,
 * highlight pages pop in as the tip passes them. */
function setGrowth(s: Scene3D, h: number) {
  const g = s.growth;
  if (!g) return;
  for (const e of g.edges) e.geo.setDrawRange(0, Math.floor(unit((h - e.yp) / e.dy) * e.segs) * TUBE_SIDES * 6);
  if (s.hIcons) for (let i = 0; i < g.ys.length; i++) s.hIcons.k[i] = easeOutBack(unit((h - g.ys[i] + 0.1) / 0.7));
}

function stepGrowth(s: Scene3D, now: number): boolean {
  const g = s.growth;
  if (!g) return false;
  const t = (now - g.t0) / 1000;
  if (t >= GROW_SECONDS) {
    setGrowth(s, Infinity);
    s.growth = null;
    return false;
  }
  // the tip starts just below the first paper (the root) and climbs to the top of the axis
  let y0 = HEIGHT;
  for (const y of g.ys) y0 = Math.min(y0, y);
  const h0 = y0 - 0.2;
  setGrowth(s, h0 + (t / GROW_SECONDS) * (HEIGHT + 1 - h0));
  return true;
}

/** (Re)build the axes and frame for one space: the domain prism, or the Topics axis with its ground. */
function buildChrome(s: Scene3D, space: CubeSpace, yearMin: number, yearMax: number) {
  const { chrome } = s;
  for (const child of [...chrome.children]) {
    chrome.remove(child);
    disposeObject(child);
  }
  s.setSpace(space);
  const V = (p: [number, number], y: number) => new THREE.Vector3(p[0], y, p[1]);
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x44443f });
  const faintMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.22 });
  const span = Math.max(1, yearMax - yearMin);

  if (space === "umap") {
    // No box: a soft ground gradient fading out from the axis, and one vertical time axis through the
    // centre, with a small cross and a year chip per tick.
    const gc = document.createElement("canvas");
    gc.width = gc.height = 256;
    const gctx = gc.getContext("2d")!;
    const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(24,24,22,0.16)");
    grad.addColorStop(0.55, "rgba(24,24,22,0.06)");
    grad.addColorStop(1, "rgba(24,24,22,0)");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, 256, 256);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(GROUND_RADIUS, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false }),
    );
    ground.position.y = 0.005;
    chrome.add(ground);
    chrome.add(bar(V([0, 0], 0), V([0, 0], HEIGHT), 0.02, inkMat));
    const arm = 0.45;
    for (const yr of niceTicks(yearMin, yearMax)) {
      const y = ((yr - yearMin) / span) * HEIGHT;
      chrome.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints([V([-arm, 0], y), V([arm, 0], y), V([0, -arm], y), V([0, arm], y)]),
          faintMat,
        ),
      );
      const lbl = chipSprite(String(yr));
      lbl.position.set(0.9, y, 0); // no userData.face: syncView leaves it alone, so it stays visible from every angle
      chrome.add(lbl);
    }
    s.chromeSpace = space;
    applyChromeAlpha(s);
    return;
  }

  const corners = TRIANGLE;
  const n = corners.length;
  // floor: each corner glows in its domain colour (it doubles as the legend)
  const floor = new THREE.BufferGeometry();
  const pastel = (col: THREE.Color) => col.clone().lerp(new THREE.Color(0xfbfbf9), 0.72);
  const tris = corners.map((k) => V(k, 0));
  const fcols = [pastel(cA), pastel(cB), pastel(cC)];
  floor.setAttribute("position", new THREE.Float32BufferAttribute(tris.flatMap((v) => [v.x, v.y, v.z]), 3));
  floor.setAttribute("color", new THREE.Float32BufferAttribute(fcols.flatMap((col) => [col.r, col.g, col.b]), 3));
  const floorMesh = new THREE.Mesh(
    floor,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
  );
  floorMesh.position.y = -0.01;
  chrome.add(floorMesh);

  // chunky frame: bottom + top triangles and a vertical post at each corner
  for (const y of [0, HEIGHT]) {
    for (let i = 0; i < n; i++) chrome.add(bar(V(corners[i], y), V(corners[(i + 1) % n], y), y === 0 ? 0.03 : 0.018, inkMat));
  }
  for (const k of corners) chrome.add(bar(V(k, 0), V(k, HEIGHT), 0.014, inkMat));

  // year ticks: a faint triangle at each, plus a white year chip on each face (crossfaded in syncView)
  for (const yr of niceTicks(yearMin, yearMax)) {
    const y = ((yr - yearMin) / span) * HEIGHT;
    if (y > 0.05 && y < HEIGHT - 0.05) {
      chrome.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners.map((k) => V(k, y))), faintMat));
    }
    for (let face = 0; face < n; face++) {
      const lbl = chipSprite(String(yr));
      lbl.userData.tickY = y;
      lbl.userData.face = face;
      chrome.add(lbl);
    }
  }

  const names: [string, [number, number], string][] = [
    ["Sensing", corners[0], DOMAIN_COLORS.sensing],
    ["Communication", corners[1], DOMAIN_COLORS.communication],
    ["Computing", corners[2], DOMAIN_COLORS.computing],
  ];
  for (const [text, p, col] of names) {
    const lbl = labelSprite(text, col, 0.95);
    const out = Math.hypot(p[0], p[1]) || 1;
    lbl.position.set(p[0] + (p[0] / out) * 1.7, HEIGHT + 0.9, p[1] + (p[1] / out) * 1.7);
    chrome.add(lbl);
  }
  s.chromeSpace = space;
  applyChromeAlpha(s);
}

export default function PaperCube({
  papers,
  yearMin,
  yearMax,
  sizeBy,
  selectedWid,
  onSelect,
  mode,
  space,
  frame,
  ghost,
  highlights,
  view,
}: PaperCubeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const s3 = useRef<Scene3D | null>(null);
  const papersRef = useRef<PersonPaper[]>([]);
  const onSelectRef = useRef(onSelect);
  const highlightsRef = useRef<PersonPaper[]>([]);
  const growRaf = useRef(0); // the roots growing
  const modeRef = useRef(mode);
  const animRaf = useRef(0);
  const dotsRaf = useRef(0); // the paper intro / space-morph animation
  useEffect(() => {
    onSelectRef.current = onSelect;
    modeRef.current = mode;
  }, [onSelect, mode]);

  // ---- one-time scene setup ------------------------------------------------
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(6, 14, 8);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.minDistance = 4;
    controls.maxDistance = 160;

    const chrome = new THREE.Group();
    const dots = new THREE.Group();
    const traj = new THREE.Group();
    scene.add(chrome, dots, traj);

    // selection marker: a fine ink ring that always faces the camera
    const ringCanvas = document.createElement("canvas");
    ringCanvas.width = ringCanvas.height = 128;
    const rctx = ringCanvas.getContext("2d")!;
    rctx.beginPath();
    rctx.arc(64, 64, 58, 0, Math.PI * 2);
    rctx.lineWidth = 5;
    rctx.strokeStyle = "#181816";
    rctx.stroke();
    const ringTex = new THREE.CanvasTexture(ringCanvas);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, depthTest: false, transparent: true }));
    halo.renderOrder = 9;
    scene.add(halo);
    halo.visible = false;

    let raf = 0;
    const render = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        renderer.render(scene, camera);
      });
    };
    // Year chips: one set per side face, crossfaded by how squarely each face points at the camera.
    let faces = facesOf("triangle");
    const setSpace = (sp: CubeSpace) => {
      faces = facesOf(sp);
    };
    const syncView = () => {
      const sc = s3.current;
      if (sc?.points && sc.icons) placeIcons(sc.points, sc.icons, camera, controls.target);
      if (sc?.nodes && sc.hIcons) placeIcons(sc.nodes, sc.hIcons, camera, controls.target);
      if (sc) sc.rootK.value = zoomK(camera, controls.target);
      const dx = camera.position.x - controls.target.x;
      const dy = camera.position.y - controls.target.y;
      const dz = camera.position.z - controls.target.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const weights = faces.map((f) => smoothstep(0.3, 0.7, (f.nx * dx + f.nz * dz) / dist));
      for (const o of chrome.children) {
        const i = o.userData.face as number | undefined;
        if (i === undefined) continue;
        const f = faces[i];
        const sp = o as THREE.Sprite;
        const w = weights[i] * (s3.current?.chromeAlpha ?? 1);
        sp.visible = w > 0.01;
        (sp.material as THREE.SpriteMaterial).opacity = w;
        sp.position.set(f.mx + f.nx * 0.95, o.userData.tickY as number, f.mz + f.nz * 0.95);
      }
    };
    controls.addEventListener("change", () => {
      syncView();
      render();
    });
    controls.addEventListener("start", () => {
      cancelAnimationFrame(animRaf.current);
    });

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      // centre the scene in the free band between the Views panel (left) and the year ruler (right)
      if (w > 900) camera.setViewOffset(w, h, -24, 0, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // click-to-select, ignoring drags (orbit / pan)
    const ray = new THREE.Raycaster();
    const ndc = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved > 4) return;
      const trajectoryMode = modeRef.current === "trajectory";
      const mesh = trajectoryMode ? s3.current?.nodes : s3.current?.points;
      if (!mesh) return;
      ray.setFromCamera(ndc(e), camera);
      const idx = ray.intersectObject(mesh, false)[0]?.instanceId;
      const list = trajectoryMode ? highlightsRef.current : papersRef.current;
      onSelectRef.current(idx != null ? (list[idx]?.wid ?? null) : null);
    };
    const onMove = (e: PointerEvent) => {
      if (down) return;
      const mesh = modeRef.current === "trajectory" ? s3.current?.nodes : s3.current?.points;
      if (!mesh) return;
      ray.setFromCamera(ndc(e), camera);
      renderer.domElement.style.cursor = ray.intersectObject(mesh, false).length ? "pointer" : "grab";
    };
    const el = renderer.domElement;
    el.style.cursor = "grab";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);

    const ramp = toonRamp();
    const paperTex = paperTexture();
    s3.current = {
      renderer, scene, camera, controls, chrome, dots, ramp, paperTex, icons: null, points: null, nodes: null, traj, halo,
      render, syncView, setSpace,
      chromeSpace: "triangle", chromeAlpha: 1, dotsSpace: "triangle", posByWid: new Map(), introDone: false,
      years: [0, 1], anim: null, hIcons: null, rootK: { value: 1 }, growth: null, regrow: null, trajMode: "papers",
    };
    resize();
    return () => {
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      controls.dispose();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(animRaf.current);
      cancelAnimationFrame(dotsRaf.current);
      cancelAnimationFrame(growRaf.current);
      disposeObject(scene);
      ramp.dispose();
      paperTex.dispose();
      renderer.dispose();
      host.removeChild(el);
      s3.current = null;
    };
  }, []);

  // ---- camera presets (animated; spherical interpolation so the camera never cuts through the prism)
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    const goal = HOME;
    const { camera, controls } = s;
    const duration = view.n === 0 ? 0 : 700;
    const t0 = performance.now();
    const startTarget = controls.target.clone();
    const startFov = camera.fov;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(startTarget));
    const to = new THREE.Spherical().setFromVector3(goal.offset);
    let dTheta = to.theta - from.theta;
    dTheta = ((((dTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    cancelAnimationFrame(animRaf.current);
    const step = (now: number) => {
      const k = duration === 0 ? 1 : Math.min(1, (now - t0) / duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      controls.target.lerpVectors(startTarget, TARGET, e);
      const sph = new THREE.Spherical(
        from.radius + (to.radius - from.radius) * e,
        from.phi + (to.phi - from.phi) * e,
        from.theta + dTheta * e,
      );
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.fov = startFov + (goal.fov - startFov) * e;
      camera.updateProjectionMatrix();
      controls.update();
      s.syncView();
      s.render();
      if (k < 1) animRaf.current = requestAnimationFrame(step);
    };
    step(t0);
  }, [view]);

  // ---- axes / frame: rebuilt when the year range changes (space switches are driven by the papers effect) ----
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    s.years = [yearMin, yearMax];
    buildChrome(s, s.chromeSpace, yearMin, yearMax);
    s.syncView();
    s.render();
  }, [yearMin, yearMax]);

  // ---- the papers themselves --------------------------------------------------
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    papersRef.current = papers;
    // A new build supersedes a running animation: settle the axes and the trajectory first.
    cancelAnimationFrame(dotsRaf.current);
    if (s.anim) {
      s.anim = null;
      s.chromeAlpha = 1;
      applyChromeAlpha(s);
      s.traj.visible = true;
    }
    s.years = [yearMin, yearMax];
    for (const child of [...s.dots.children]) {
      s.dots.remove(child);
      disposeObject(child);
    }
    s.points = null;
    s.icons = null;
    const prevPos = s.posByWid;
    s.posByWid = new Map();
    let anim: Anim | null = null;

    // Trajectory mode: papers become faint, smaller context icons (or vanish entirely).
    const ghosting = mode === "trajectory";
    if (papers.length && !(ghosting && !ghost)) {
      // Each paper is a flat page icon that always faces the camera (re-aimed in syncView).
      const front = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: s.paperTex,
          alphaTest: 0.02,
          transparent: true,
          opacity: ghosting ? GHOST_ALPHA : ICON_ALPHA,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        papers.length,
      );
      // soft contact shadows on the floor, to read depth at a glance (Domains only)
      const shadow = new THREE.InstancedMesh(
        new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.07, depthWrite: false }),
        papers.length,
      );
      shadow.renderOrder = -1;
      const wantShadow = !ghosting && space !== "umap";

      let vmax = 0;
      for (const p of papers) vmax = Math.max(vmax, sizeValue(p, sizeBy));
      const icons: IconData = {
        pos: new Float32Array(papers.length * 3),
        w: new Float32Array(papers.length),
        h: new Float32Array(papers.length),
        k: new Float32Array(papers.length).fill(1),
      };
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      papers.forEach((p, i) => {
        const [x, y, z] = paperPoint(space, p, frame, yearMin, yearMax);
        const t = sizeBy === "constant" || vmax === 0 ? 0.5 : Math.sqrt(sizeValue(p, sizeBy) / vmax);
        const r = (R_MIN + (R_MAX - R_MIN) * t) * (ghosting ? GHOST_SCALE : 1);
        icons.pos.set([x, y, z], 3 * i);
        s.posByWid.set(p.wid, [x, y, z]);
        icons.h[i] = r * ICON_HEIGHT;
        icons.w[i] = r * ICON_HEIGHT * ICON_ASPECT;
        m4.makeScale(r * 1.1, 1, r * 1.1).setPosition(x, 0.015, z);
        shadow.setMatrixAt(i, m4);
        col.setRGB(
          cA.r * p.sensing + cB.r * p.communication + cC.r * p.computing,
          cA.g * p.sensing + cB.g * p.communication + cC.g * p.computing,
          cA.b * p.sensing + cB.b * p.communication + cC.b * p.computing,
        );
        front.setColorAt(i, col.lerp(PAPER_GREY, 1 - PAPER_TINT));
      });
      shadow.instanceMatrix.needsUpdate = true;
      if (front.instanceColor) front.instanceColor.needsUpdate = true;

      // First appearance: grow in, oldest first. Space switch: glide from the old layout, oldest first.
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const kind = reduce ? null : !s.introDone ? "intro" : space !== s.dotsSpace ? "morph" : null;
      s.introDone = true;
      if (kind) {
        const n = papers.length;
        const to = icons.pos.slice();
        const from = to.slice();
        const popIn = new Uint8Array(n);
        const delay = new Float32Array(n);
        let maxDelay = 0;
        for (let i = 0; i < n; i++) {
          delay[i] = (to[3 * i + 1] / HEIGHT) * STAGGER;
          maxDelay = Math.max(maxDelay, delay[i]);
        }
        if (kind === "morph") {
          papers.forEach((p, i) => {
            const q = prevPos.get(p.wid);
            if (q) from.set(q, 3 * i);
            else popIn[i] = 1;
          });
          icons.pos.set(from);
        }
        for (let i = 0; i < n; i++) icons.k[i] = kind === "intro" || popIn[i] ? 0 : 1;
        anim = { kind, t0: performance.now(), from, to, popIn, delay, tPapers: maxDelay + PAPER_DUR, space, swapped: false, shadow: wantShadow ? shadow : null };
      } else if (wantShadow) {
        s.dots.add(shadow);
      }
      placeIcons(front, icons, s.camera, s.controls.target);
      s.dots.add(front);
      s.points = front;
      s.icons = icons;
    }
    s.dotsSpace = space;

    if (anim) {
      s.anim = anim;
      if (anim.kind === "morph") s.traj.visible = false; // the year path reappears once everything has landed
      else if (s.chromeSpace !== space) buildChrome(s, space, yearMin, yearMax);
      const loop = (now: number) => {
        if (s3.current !== s || !s.anim) return;
        const running = stepAnim(s, now);
        s.syncView();
        s.render();
        if (running) dotsRaf.current = requestAnimationFrame(loop);
      };
      dotsRaf.current = requestAnimationFrame(loop);
    } else if (s.chromeSpace !== space) {
      buildChrome(s, space, yearMin, yearMax);
    }
    s.syncView();
    s.render();
  }, [papers, yearMin, yearMax, sizeBy, mode, ghost, space, frame]);

  // ---- trajectory: roots that grow up the axis through the person's highlight papers ----
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    highlightsRef.current = highlights;
    cancelAnimationFrame(growRaf.current);
    s.growth = null;
    s.regrow = null;
    for (const child of [...s.traj.children]) {
      s.traj.remove(child);
      disposeObject(child);
    }
    s.nodes = null;
    s.hIcons = null;
    const entering = s.trajMode !== "trajectory";
    s.trajMode = mode;
    if (mode === "trajectory" && highlights.length) {
      const n = highlights.length;
      const pts = highlights.map((p) => paperPoint(space, p, frame, yearMin, yearMax));

      // the highlight pages: full strength, a little larger than the ghosts behind them
      const front = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: s.paperTex, alphaTest: 0.02, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
        n,
      );
      front.renderOrder = 2;
      let vmax = 0;
      for (const p of highlights) vmax = Math.max(vmax, sizeValue(p, sizeBy));
      const icons: IconData = {
        pos: new Float32Array(n * 3),
        w: new Float32Array(n),
        h: new Float32Array(n),
        k: new Float32Array(n).fill(1),
      };
      const col = new THREE.Color();
      const ink = new THREE.Color(INK);
      const edgeCols: THREE.Color[] = [];
      highlights.forEach((p, i) => {
        const t = sizeBy === "constant" || vmax === 0 ? 0.5 : Math.sqrt(sizeValue(p, sizeBy) / vmax);
        const r = (R_MIN + (R_MAX - R_MIN) * t) * HIGHLIGHT_SCALE;
        icons.pos.set(pts[i], 3 * i);
        icons.h[i] = r * ICON_HEIGHT;
        icons.w[i] = r * ICON_HEIGHT * ICON_ASPECT;
        col.setRGB(
          cA.r * p.sensing + cB.r * p.communication + cC.r * p.computing,
          cA.g * p.sensing + cB.g * p.communication + cC.g * p.computing,
          cA.b * p.sensing + cB.b * p.communication + cC.b * p.computing,
        );
        edgeCols.push(col.clone().lerp(ink, 0.3)); // a branch wears the colour of the paper it ends on
        front.setColorAt(i, col.lerp(PAPER_GREY, 1 - HIGHLIGHT_TINT));
      });
      if (front.instanceColor) front.instanceColor.needsUpdate = true;

      // the roots: the first highlight is the root, and every other one hangs off the nearest earlier
      // one, by a curve that leaves its parent heading up and arrives at the paper heading up
      const { parent, size } = buildRoots(highlights.map((p, i) => ({ x: pts[i][0], y: pts[i][1], z: pts[i][2], year: p.year })));
      const radius = (sz: number) => ROOT_R_MIN + (ROOT_R_MAX - ROOT_R_MIN) * Math.sqrt(sz / n);
      const mat = rootMaterial(s.ramp, s.rootK);
      const edges: Growth["edges"] = [];
      for (let i = 0; i < n; i++) {
        if (parent[i] < 0) continue; // the root paper has no branch above it
        const from = new THREE.Vector3(...pts[parent[i]]);
        const to = new THREE.Vector3(...pts[i]);
        const dy = Math.max(to.y - from.y, 0.5);
        const curve = new THREE.CubicBezierCurve3(
          from,
          from.clone().add(new THREE.Vector3(0, 0.55 * dy, 0)),
          to.clone().sub(new THREE.Vector3(0, 0.45 * dy, 0)),
          to,
        );
        const samples: SplineSample[] = Array.from({ length: ROOT_STEPS + 1 }, (_, k) => ({
          p: curve.getPoint(k / ROOT_STEPS),
          seg: 0,
          u: k / ROOT_STEPS,
        }));
        const r0 = radius(size[parent[i]]);
        const r1 = radius(size[i]);
        const tube = tubeAlong(samples, (sm) => r0 + (r1 - r0) * sm.u, () => edgeCols[i], mat);
        tube.frustumCulled = false; // its bounds are the centre line, not the surface
        s.traj.add(tube);
        edges.push({ geo: tube.geometry, segs: ROOT_STEPS, yp: from.y, dy });
      }

      placeIcons(front, icons, s.camera, s.controls.target);
      s.traj.add(front);
      s.nodes = front;
      s.hIcons = icons;

      const ys = Float32Array.from(pts, (q) => q[1]);
      const startGrowth = () => {
        cancelAnimationFrame(growRaf.current);
        s.growth = { t0: performance.now(), edges, ys };
        setGrowth(s, -1); // nothing yet: the roots start from the first paper
        s.syncView();
        s.render();
        const loop = (now: number) => {
          if (s3.current !== s || !s.growth) return;
          const running = stepGrowth(s, now);
          s.syncView();
          s.render();
          if (running) growRaf.current = requestAnimationFrame(loop);
        };
        growRaf.current = requestAnimationFrame(loop);
      };
      s.regrow = startGrowth;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      // Grow when the mode is entered; after a space switch the morph hands over via `regrow`.
      if (entering && !reduce && s.anim?.kind !== "morph") startGrowth();
    }
    s.syncView();
    s.render();
  }, [highlights, mode, sizeBy, yearMin, yearMax, space, frame]);

  // ---- selection marker --------------------------------------------------------
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    const trajectoryMode = mode === "trajectory";
    const mesh = trajectoryMode ? s.nodes : s.points;
    const list = trajectoryMode ? highlightsRef.current : papersRef.current;
    const i = selectedWid == null ? -1 : list.findIndex((p) => p.wid === selectedWid);
    if (i < 0 || !mesh) {
      s.halo.visible = false;
    } else {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      m.decompose(pos, new THREE.Quaternion(), scl);
      s.halo.position.copy(pos);
      s.halo.scale.setScalar(scl.y * 1.35); // paper icons are tall quads: scale.y is the height
      s.halo.visible = true;
    }
    s.render();
  }, [selectedWid, mode, highlights, papers, yearMin, yearMax, sizeBy, ghost, space, frame]);

  return <div className="paper-cube" ref={hostRef} />;
}
