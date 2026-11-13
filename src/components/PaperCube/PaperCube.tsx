import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PersonPaper } from "../../lib/personPapers";
import type { YearPoint } from "../../lib/trajectory";
import { DOMAIN_COLORS, DOMAIN_COLORS_VIVID } from "../../lib/ternary";

export type PaperSizeMetric = "constant" | "citations" | "coauthors";

/** Every paper as a dot, or one node per year joined into a path. */
export type CubeMode = "papers" | "trajectory";

/** Camera presets: the default 3/4 view, straight down, or square-on to one prism face
 * (AB = Sensing/Communication, BC = Communication/Computing, CA = Computing/Sensing). */
export type ViewId = "home" | "top" | "AB" | "BC" | "CA";

interface PaperCubeProps {
  papers: PersonPaper[]; // already year-filtered by the parent
  yearMin: number;
  yearMax: number;
  sizeBy: PaperSizeMetric;
  selectedWid: number | null;
  onSelect: (wid: number | null) => void;
  mode: CubeMode;
  /** Trajectory mode: keep the individual papers visible as faint context. */
  ghost: boolean;
  /** One weighted-average point per year (only drawn in trajectory mode). */
  trajectory: YearPoint[];
  selectedYear: number | null;
  onSelectYear: (year: number | null) => void;
  /** Requested camera preset; bump `n` to re-apply the same preset (n=0 applies instantly on mount). */
  view: { id: ViewId; n: number };
  /** Fired when the user grabs the camera, so the parent can drop the active-preset highlight. */
  onOrbit: () => void;
}

// World units. The ternary triangle is SIDE wide; time runs up the Y axis over HEIGHT.
const SIDE = 10;
const HEIGHT = 10;
const R_MIN = 0.09;
const R_MAX = 0.42;
const GHOST_SCALE = 0.5; // paper dots shrink to this fraction behind a trajectory
const GHOST_ALPHA = 0.28;
const OUTLINE = 1.07; // hairline outline shell scale relative to the dot
const INK = 0x181816;
const OUTLINE_INK = 0x3a3a35;
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
const FACE_EDGES: [keyof typeof CORNERS, keyof typeof CORNERS][] = [
  ["A", "B"],
  ["B", "C"],
  ["C", "A"],
];

function pointXZ(p: { sensing: number; communication: number; computing: number }): XZ {
  const { A, B, C } = CORNERS;
  return [
    p.sensing * A[0] + p.communication * B[0] + p.computing * C[0],
    p.sensing * A[1] + p.communication * B[1] + p.computing * C[1],
  ];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TARGET = new THREE.Vector3(0, HEIGHT / 2, 0);
// Preset views use a narrow field of view from far back, which reads as near-orthographic.
const NARROW_FOV = 8;
const NARROW_DIST = 125;

function presetFor(id: ViewId): { offset: THREE.Vector3; fov: number } {
  // a touch further back than a tight fit, so corner labels and the year chips have room
  if (id === "home") return { offset: new THREE.Vector3(19, 7.5, 21.5), fov: 40 };
  if (id === "top") return { offset: new THREE.Vector3(0, 128, 0.01), fov: NARROW_FOV };
  const [p, q] = FACE_EDGES[id === "AB" ? 0 : id === "BC" ? 1 : 2];
  const mx = (CORNERS[p][0] + CORNERS[q][0]) / 2;
  const mz = (CORNERS[p][1] + CORNERS[q][1]) / 2;
  const len = Math.hypot(mx, mz) || 1;
  return { offset: new THREE.Vector3((mx / len) * NARROW_DIST, 0, (mz / len) * NARROW_DIST), fov: NARROW_FOV };
}

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

const SPLINE_STEPS = 18; // samples per year-to-year stretch
const TUBE_SIDES = 10;

interface SplineSample {
  p: THREE.Vector3;
  /** Which stretch (node i -> i+1) this sample lies on, and how far along it (0..1). */
  seg: number;
  u: number;
}

/** Sample a centripetal Catmull-Rom spline that passes exactly through every node. */
function splineSamples(nodes: THREE.Vector3[]): SplineSample[] {
  if (nodes.length < 2) return [];
  const curve = new THREE.CatmullRomCurve3(nodes, false, "centripetal");
  const stretches = nodes.length - 1;
  const total = stretches * SPLINE_STEPS;
  const out: SplineSample[] = [];
  for (let k = 0; k <= total; k++) {
    const t = k / total;
    const seg = Math.min(stretches - 1, Math.floor(t * stretches));
    out.push({ p: curve.getPoint(t), seg, u: t * stretches - seg });
  }
  return out;
}

/**
 * A smooth tube along the samples with a per-sample radius and colour (parallel-transport
 * frames, so it never twists). One mesh, one draw call, smooth shading.
 */
function tubeAlong(
  samples: SplineSample[],
  radiusAt: (s: SplineSample) => number,
  colorAt: (s: SplineSample) => THREE.Color,
  material: THREE.Material,
): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array(n * TUBE_SIDES * 3);
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
      positions[o] = samples[k].p.x + dir.x * r;
      positions[o + 1] = samples[k].p.y + dir.y * r;
      positions[o + 2] = samples[k].p.z + dir.z * r;
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
  /** Trajectory year nodes (pickable) and the group holding nodes + path. */
  nodes: THREE.InstancedMesh | null;
  traj: THREE.Group;
  halo: THREE.Sprite;
  render: () => void;
  /** Materials that fade as the camera rises toward a top-down view (set by the dots effect). */
  fadeMats: THREE.Material[];
  /** Crossfade the year chips between faces, and fade the dots, for the current camera angle. */
  syncView: () => void;
}

export default function PaperCube({
  papers,
  yearMin,
  yearMax,
  sizeBy,
  selectedWid,
  onSelect,
  mode,
  ghost,
  trajectory,
  selectedYear,
  onSelectYear,
  view,
  onOrbit,
}: PaperCubeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const s3 = useRef<Scene3D | null>(null);
  const papersRef = useRef<PersonPaper[]>([]);
  const onSelectRef = useRef(onSelect);
  const trajRef = useRef<YearPoint[]>([]);
  const modeRef = useRef(mode);
  const onSelectYearRef = useRef(onSelectYear);
  const onOrbitRef = useRef(onOrbit);
  const animRaf = useRef(0);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onSelectYearRef.current = onSelectYear;
    onOrbitRef.current = onOrbit;
    modeRef.current = mode;
  }, [onSelect, onSelectYear, onOrbit, mode]);

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
    const faces = FACE_EDGES.map(([p, q]) => {
      const mx = (CORNERS[p][0] + CORNERS[q][0]) / 2;
      const mz = (CORNERS[p][1] + CORNERS[q][1]) / 2;
      const len = Math.hypot(mx, mz) || 1;
      return { mx, mz, nx: mx / len, nz: mz / len }; // centroid is the origin, so the midpoint direction is the outward normal
    });
    const syncView = () => {
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
        sp.visible = weights[i] > 0.01;
        (sp.material as THREE.SpriteMaterial).opacity = weights[i];
        sp.position.set(f.mx + f.nx * 0.95, o.userData.tickY as number, f.mz + f.nz * 0.95);
      }
      // seen from above, stacked years overlap: let the dots go see-through
      const alpha = 1 - 0.5 * smoothstep(0.55, 0.95, dy / dist);
      for (const m of s3.current?.fadeMats ?? []) {
        m.opacity = alpha;
        m.depthWrite = alpha > 0.98;
      }
    };
    controls.addEventListener("change", () => {
      syncView();
      render();
    });
    controls.addEventListener("start", () => {
      cancelAnimationFrame(animRaf.current);
      onOrbitRef.current();
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
      if (trajectoryMode) onSelectYearRef.current(idx != null ? (trajRef.current[idx]?.year ?? null) : null);
      else onSelectRef.current(idx != null ? (papersRef.current[idx]?.wid ?? null) : null);
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
    s3.current = { renderer, scene, camera, controls, chrome, dots, ramp, points: null, nodes: null, traj, halo, render, fadeMats: [], syncView };
    resize();
    return () => {
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      controls.dispose();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(animRaf.current);
      disposeObject(scene);
      ramp.dispose();
      renderer.dispose();
      host.removeChild(el);
      s3.current = null;
    };
  }, []);

  // ---- camera presets (animated; spherical interpolation so the camera never cuts through the prism)
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    const goal = presetFor(view.id);
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

  // ---- axes / triangle chrome: depends only on the year range ---------------
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    const { chrome } = s;
    for (const child of [...chrome.children]) {
      chrome.remove(child);
      disposeObject(child);
    }
    const { A: a, B: b, C: c } = CORNERS;
    const V = (p: [number, number], y: number) => new THREE.Vector3(p[0], y, p[1]);
    const inkMat = new THREE.MeshBasicMaterial({ color: 0x44443f });
    const faintMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.22 });

    // tinted ternary floor: each corner glows in its domain colour (acts as the legend)
    const floor = new THREE.BufferGeometry();
    const pos = [V(a, 0), V(b, 0), V(c, 0)].flatMap((v) => [v.x, v.y, v.z]);
    floor.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const pastel = (col: THREE.Color) => col.clone().lerp(new THREE.Color(0xfbfbf9), 0.72);
    const fc = [pastel(cA), pastel(cB), pastel(cC)].flatMap((col) => [col.r, col.g, col.b]);
    floor.setAttribute("color", new THREE.Float32BufferAttribute(fc, 3));
    const floorMesh = new THREE.Mesh(
      floor,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    floorMesh.position.y = -0.01;
    chrome.add(floorMesh);

    // chunky frame: bottom + top triangles and three vertical posts
    const corners = [a, b, c];
    for (const y of [0, HEIGHT]) {
      for (let i = 0; i < 3; i++) chrome.add(bar(V(corners[i], y), V(corners[(i + 1) % 3], y), y === 0 ? 0.03 : 0.018, inkMat));
    }
    for (const k of corners) chrome.add(bar(V(k, 0), V(k, HEIGHT), 0.014, inkMat));

    // year ticks: a faint triangle at each, plus a white year chip on each face (crossfaded in syncView)
    const span = Math.max(1, yearMax - yearMin);
    for (const yr of niceTicks(yearMin, yearMax)) {
      const y = ((yr - yearMin) / span) * HEIGHT;
      if (y > 0.05 && y < HEIGHT - 0.05) {
        chrome.add(
          new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(a, y), V(b, y), V(c, y)]), faintMat),
        );
      }
      for (let face = 0; face < 3; face++) {
        const lbl = chipSprite(String(yr));
        lbl.userData.tickY = y;
        lbl.userData.face = face;
        chrome.add(lbl);
      }
    }

    const names: [string, [number, number], string][] = [
      ["Sensing", a, DOMAIN_COLORS.sensing],
      ["Communication", b, DOMAIN_COLORS.communication],
      ["Computing", c, DOMAIN_COLORS.computing],
    ];
    for (const [text, p, col] of names) {
      const lbl = labelSprite(text, col, 0.95);
      const out = Math.hypot(p[0], p[1]) || 1;
      lbl.position.set(p[0] + (p[0] / out) * 1.7, HEIGHT + 0.9, p[1] + (p[1] / out) * 1.7);
      chrome.add(lbl);
    }
    s.syncView();
    s.render();
  }, [yearMin, yearMax]);

  // ---- the papers themselves --------------------------------------------------
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    papersRef.current = papers;
    for (const child of [...s.dots.children]) {
      s.dots.remove(child);
      disposeObject(child);
    }
    s.points = null;
    s.fadeMats = [];

    // Trajectory mode: papers become faint, smaller context dots (or vanish entirely).
    const ghosting = mode === "trajectory";
    if (papers.length && !(ghosting && !ghost)) {
      const sphere = new THREE.SphereGeometry(1, 20, 14);
      const front = new THREE.InstancedMesh(
        sphere,
        new THREE.MeshToonMaterial({ gradientMap: s.ramp, transparent: true, opacity: ghosting ? GHOST_ALPHA : 1 }),
        papers.length,
      );
      // ink outline: an inverted-hull shell, slightly larger, back faces only
      const outline = new THREE.InstancedMesh(
        sphere.clone(),
        new THREE.MeshBasicMaterial({ color: OUTLINE_INK, side: THREE.BackSide, transparent: true, opacity: ghosting ? GHOST_ALPHA : 1 }),
        papers.length,
      );
      // soft contact shadows on the floor, to read depth at a glance
      const shadow = new THREE.InstancedMesh(
        new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.07, depthWrite: false }),
        papers.length,
      );

      const span = Math.max(1, yearMax - yearMin);
      let vmax = 0;
      for (const p of papers) vmax = Math.max(vmax, sizeValue(p, sizeBy));
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      papers.forEach((p, i) => {
        const [x, z] = pointXZ(p);
        // spread same-year papers slightly in height so they don't z-stack into one column
        const jitter = ((p.wid % 997) / 997 - 0.5) * (HEIGHT / span) * 0.6;
        const y = Math.min(HEIGHT, Math.max(0, ((p.year - yearMin) / span) * HEIGHT + jitter));
        const t = sizeBy === "constant" || vmax === 0 ? 0.5 : Math.sqrt(sizeValue(p, sizeBy) / vmax);
        const r = (R_MIN + (R_MAX - R_MIN) * t) * (ghosting ? GHOST_SCALE : 1);
        m4.makeScale(r, r, r).setPosition(x, y, z);
        front.setMatrixAt(i, m4);
        m4.makeScale(r * OUTLINE, r * OUTLINE, r * OUTLINE).setPosition(x, y, z);
        outline.setMatrixAt(i, m4);
        m4.makeScale(r * 1.1, 1, r * 1.1).setPosition(x, 0.015, z);
        shadow.setMatrixAt(i, m4);
        col.setRGB(
          cA.r * p.sensing + cB.r * p.communication + cC.r * p.computing,
          cA.g * p.sensing + cB.g * p.communication + cC.g * p.computing,
          cA.b * p.sensing + cB.b * p.communication + cC.b * p.computing,
        );
        front.setColorAt(i, col);
      });
      for (const m of [front, outline, shadow]) m.instanceMatrix.needsUpdate = true;
      if (front.instanceColor) front.instanceColor.needsUpdate = true;
      front.computeBoundingSphere();
      shadow.renderOrder = -1;
      if (!ghosting) s.dots.add(shadow);
      s.dots.add(outline, front);
      s.points = front;
      // seen from above, only the full-strength dots go see-through (ghosts already are)
      if (!ghosting) s.fadeMats = [front.material as THREE.Material, outline.material as THREE.Material];
    }
    s.syncView();
    s.render();
  }, [papers, yearMin, yearMax, sizeBy, mode, ghost]);

  // ---- trajectory: one node per year at the weighted-average position, joined by a path ----
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    trajRef.current = trajectory;
    for (const child of [...s.traj.children]) {
      s.traj.remove(child);
      disposeObject(child);
    }
    s.nodes = null;
    if (mode === "trajectory" && trajectory.length) {
      const span = Math.max(1, yearMax - yearMin);
      const nmax = Math.max(1, ...trajectory.map((p) => p.n));
      const pts = trajectory.map((p) => {
        const [x, z] = pointXZ(p.smooth);
        return new THREE.Vector3(x, Math.min(HEIGHT, Math.max(0, ((p.year - yearMin) / span) * HEIGHT)), z);
      });
      const cols = trajectory.map(
        (p) =>
          new THREE.Color(
            cA.r * p.smooth.sensing + cB.r * p.smooth.communication + cC.r * p.smooth.computing,
            cA.g * p.smooth.sensing + cB.g * p.smooth.communication + cC.g * p.smooth.computing,
            cA.b * p.smooth.sensing + cB.b * p.smooth.communication + cC.b * p.smooth.computing,
          ),
      );
      // Long careers pack many years into the same height: shrink nodes and path together so
      // neighbouring years stay separate and the curve between them stays visible.
      const dense = Math.min(1, Math.max(0.3, ((HEIGHT / span) * 1.1) / 0.53));
      const rad = (p: YearPoint) => (0.17 + 0.36 * Math.sqrt(p.n / nmax)) * dense;

      // year nodes (+ ink outline shells)
      const sphere = new THREE.SphereGeometry(1, 24, 16);
      const nodes = new THREE.InstancedMesh(sphere, new THREE.MeshToonMaterial({ gradientMap: s.ramp }), trajectory.length);
      const outline = new THREE.InstancedMesh(
        sphere.clone(),
        new THREE.MeshBasicMaterial({ color: OUTLINE_INK, side: THREE.BackSide }),
        trajectory.length,
      );
      const m4 = new THREE.Matrix4();
      trajectory.forEach((p, i) => {
        const r = rad(p);
        m4.makeScale(r, r, r).setPosition(pts[i]);
        nodes.setMatrixAt(i, m4);
        m4.makeScale(r * OUTLINE, r * OUTLINE, r * OUTLINE).setPosition(pts[i]);
        outline.setMatrixAt(i, m4);
        nodes.setColorAt(i, cols[i]);
      });
      nodes.instanceMatrix.needsUpdate = true;
      outline.instanceMatrix.needsUpdate = true;
      if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
      nodes.computeBoundingSphere();
      s.traj.add(outline, nodes);
      s.nodes = nodes;

      // path: a spline through the year nodes. Thickness blends between the nodes' paper counts,
      // colour blends between their domain mixes; stretches that bridge a gap in the record
      // are washed toward paper so they read as "no data in between".
      if (trajectory.length > 1) {
        const samples = splineSamples(pts);
        const paper = new THREE.Color(0xfbfbf9);
        const ease = (u: number) => u * u * (3 - 2 * u);
        const thick = (i: number) => (0.03 + 0.12 * Math.sqrt(trajectory[i].n / nmax)) * dense;
        const tmp = new THREE.Color();
        const tube = tubeAlong(
          samples,
          (sm) => thick(sm.seg) + (thick(sm.seg + 1) - thick(sm.seg)) * ease(sm.u),
          (sm) => {
            tmp.copy(cols[sm.seg]).lerp(cols[sm.seg + 1], ease(sm.u));
            if (trajectory[sm.seg + 1].year - trajectory[sm.seg].year > 1) tmp.lerp(paper, 0.5);
            return tmp;
          },
          new THREE.MeshToonMaterial({ gradientMap: s.ramp, vertexColors: true }),
        );
        s.traj.add(tube);

        // the same curve flattened onto the floor: a faint ink trace of where the author has moved
        s.traj.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(samples.map((sm) => new THREE.Vector3(sm.p.x, 0.02, sm.p.z))),
            new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 }),
          ),
        );
      }
    }
    s.syncView();
    s.render();
  }, [trajectory, mode, yearMin, yearMax]);

  // ---- selection marker --------------------------------------------------------
  useEffect(() => {
    const s = s3.current;
    if (!s) return;
    const trajectoryMode = mode === "trajectory";
    const mesh = trajectoryMode ? s.nodes : s.points;
    const i = trajectoryMode
      ? selectedYear == null
        ? -1
        : trajRef.current.findIndex((p) => p.year === selectedYear)
      : selectedWid == null
        ? -1
        : papersRef.current.findIndex((p) => p.wid === selectedWid);
    if (i < 0 || !mesh) {
      s.halo.visible = false;
    } else {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      m.decompose(pos, new THREE.Quaternion(), scl);
      s.halo.position.copy(pos);
      s.halo.scale.setScalar(scl.x * 2.9);
      s.halo.visible = true;
    }
    s.render();
  }, [selectedWid, selectedYear, mode, trajectory, papers, yearMin, yearMax, sizeBy, ghost]);

  return <div className="paper-cube" ref={hostRef} />;
}
