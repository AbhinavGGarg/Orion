"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useReducedMotion } from "motion/react";
import { Finding, ScanState, Severity } from "@/types/scan";
import { buildGraph, SEVERITY_COLOR, type Graph, type Link, type StarKind } from "@/components/constellation-graph";

// ── The sky ──────────────────────────────────────────────────────────────────
//
// 3D version of the constellation. Same idea as the 2D one: findings are
// stars, the attack chain is the lines between them, the target sits in the
// middle. Rendered with three.js so the stars can glow (bloom) and you can
// orbit around the constellation. The layout is still the same three-rule
// force simulation, just with a z axis.

interface Body {
  id: string;
  kind: StarKind;
  severity: Severity | "none";
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  r: number;
}

const RADIUS: Record<Severity | "none", number> = {
  critical: 0.3,
  high: 0.25,
  medium: 0.21,
  low: 0.17,
  info: 0.13,
  none: 0.3,
};

const REST: Record<Link["kind"], number> = { path: 3.4, entry: 3.8, component: 2.4 };

// Small seeded random generator so the background is the same every render
// (React wants render-time code to be pure).
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const ORIGIN = new THREE.Vector3(0, 0, 0);

function stepPhysics(bodies: Body[], links: Link[], steps: number) {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (let s = 0; s < steps; s++) {
    // 1. stars push each other apart
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d = 0.5;
        }
        const reach = 4.6;
        if (d < reach) {
          const f = ((reach - d) / reach) * 0.05;
          a.vx -= (dx / d) * f;
          a.vy -= (dy / d) * f;
          a.vz -= (dz / d) * f;
          b.vx += (dx / d) * f;
          b.vy += (dy / d) * f;
          b.vz += (dz / d) * f;
        }
      }
    }
    // 2. links pull their two stars toward a rest distance
    for (const l of links) {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.max(0.05, Math.hypot(dx, dy, dz));
      const k = l.kind === "component" ? 0.008 : 0.02;
      const f = (d - REST[l.kind]) * k;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      a.vz += (dz / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
      b.vz -= (dz / d) * f;
    }
    // 3. everything drifts toward the centre, kept fairly flat so it reads well
    for (const b of bodies) {
      if (b.kind === "target") {
        b.x = b.y = b.z = 0;
        b.vx = b.vy = b.vz = 0;
        continue;
      }
      b.vx -= b.x * 0.002;
      b.vy -= b.y * 0.002;
      b.vz -= b.z * 0.012;
      b.vx *= 0.9;
      b.vy *= 0.9;
      b.vz *= 0.9;
      b.x += b.vx;
      b.y += b.vy;
      b.z += b.vz;
      const len = Math.hypot(b.x, b.y, b.z);
      if (len > 7.5) {
        b.x *= 7.5 / len;
        b.y *= 7.5 / len;
        b.z *= 7.5 / len;
      }
    }
  }
}

// ── Textures ─────────────────────────────────────────────────────────────────

function makeRadialTexture(stops: [number, string][], size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function useTextures() {
  return useMemo(() => {
    const glow = makeRadialTexture([
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.45)"],
      [0.6, "rgba(255,255,255,0.08)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    const dot = makeRadialTexture(
      [
        [0, "rgba(255,255,255,1)"],
        [0.4, "rgba(255,255,255,0.6)"],
        [1, "rgba(255,255,255,0)"],
      ],
      64,
    );
    const ring = (() => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
      ctx.stroke();
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    return { glow, dot, ring };
  }, []);
}

// ── Background ───────────────────────────────────────────────────────────────

function BackgroundStars({ reduce, dot }: { reduce: boolean; dot: THREE.Texture }) {
  const far = useRef<THREE.Points>(null);
  const near = useRef<THREE.Points>(null);

  const [farGeo, nearGeo] = useMemo(() => {
    const make = (count: number, rMin: number, rMax: number, seed: number) => {
      const rand = seededRandom(seed);
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = rMin + rand() * (rMax - rMin);
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 2] = r * Math.cos(phi);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      return geo;
    };
    return [make(2600, 45, 95, 7), make(500, 14, 32, 11)];
  }, []);

  useFrame((_, dt) => {
    if (reduce) return;
    if (far.current) far.current.rotation.y += dt * 0.006;
    if (near.current) near.current.rotation.y -= dt * 0.01;
  });

  return (
    <>
      <points ref={far} geometry={farGeo}>
        <pointsMaterial
          map={dot}
          size={0.55}
          sizeAttenuation
          color="#dbe4ff"
          transparent
          opacity={0.75}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <points ref={near} geometry={nearGeo}>
        <pointsMaterial
          map={dot}
          size={0.18}
          sizeAttenuation
          color="#c7d2fe"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

function Nebulae({ glow }: { glow: THREE.Texture }) {
  const clouds = useMemo(
    () => [
      { pos: [-14, 6, -30] as const, scale: 42, color: "#4338ca", opacity: 0.16 },
      { pos: [16, -4, -36] as const, scale: 48, color: "#0e7490", opacity: 0.13 },
      { pos: [4, 12, -40] as const, scale: 36, color: "#6d28d9", opacity: 0.12 },
      { pos: [-6, -12, -34] as const, scale: 30, color: "#1d4ed8", opacity: 0.1 },
    ],
    [],
  );
  return (
    <>
      {clouds.map((c, i) => (
        <sprite key={i} position={[c.pos[0], c.pos[1], c.pos[2]]} scale={[c.scale, c.scale, 1]}>
          <spriteMaterial map={glow} color={c.color} transparent opacity={c.opacity} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </>
  );
}

// ── Stars ────────────────────────────────────────────────────────────────────

interface StarProps {
  star: Graph["stars"][number];
  sim: React.MutableRefObject<Map<string, Body>>;
  hovered: boolean;
  dimmed: boolean;
  reduce: boolean;
  isRunning: boolean;
  textures: { glow: THREE.Texture; ring: THREE.Texture };
  onHover: (id: string | null) => void;
  onClick: (star: Graph["stars"][number]) => void;
}

function StarNode({ star, sim, hovered, dimmed, reduce, isRunning, textures, onHover, onClick }: StarProps) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Sprite>(null);
  const pulseRef = useRef<THREE.Sprite>(null);
  const phase = useMemo(() => (hashString(star.id) % 1000) / 1000 * Math.PI * 2, [star.id]);
  const scaleRef = useRef(0);

  const hex = SEVERITY_COLOR[star.severity];
  const r = star.kind === "waypoint" ? 0.13 : RADIUS[star.severity];
  const coreColor = useMemo(() => {
    const c = new THREE.Color(hex);
    const boost = star.kind === "target" ? 2.4 : star.severity === "critical" || star.severity === "high" ? 1.9 : star.severity === "info" ? 1.0 : 1.5;
    return c.lerp(new THREE.Color("#ffffff"), star.kind === "target" ? 0.85 : star.severity === "critical" ? 0.04 : 0.12).multiplyScalar(boost);
  }, [hex, star.kind, star.severity]);

  useFrame((state) => {
    const b = sim.current.get(star.id);
    const g = group.current;
    if (!b || !g) return;
    g.position.set(b.x, b.y, b.z);
    const t = state.clock.elapsedTime;
    const age = Math.max(0, performance.now() - b.born);
    const birth = reduce ? 1 : Math.min(1, age / 900);
    const ease = 1 - Math.pow(1 - birth, 3);
    const target = ease * (hovered ? 1.45 : 1) * (dimmed ? 0.8 : 1);
    scaleRef.current += (target - scaleRef.current) * 0.15;
    const twinkle = reduce ? 1 : 1 + 0.06 * Math.sin(t * 2.3 + phase);
    inner.current?.scale.setScalar(scaleRef.current * twinkle);

    if (ringRef.current) {
      if (!reduce && age < 1300 && star.kind !== "target") {
        const k = age / 1300;
        ringRef.current.visible = true;
        ringRef.current.scale.setScalar(0.6 + k * 4.5);
        (ringRef.current.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.9;
      } else {
        ringRef.current.visible = false;
      }
    }
    if (pulseRef.current) {
      if (star.kind === "target" && isRunning && !reduce) {
        const k = (t * 0.55) % 1;
        pulseRef.current.visible = true;
        pulseRef.current.scale.setScalar(1 + k * 7);
        (pulseRef.current.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.6;
      } else {
        pulseRef.current.visible = false;
      }
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onHover(star.id);
  };
  const out = () => onHover(null);
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(star);
  };

  return (
    <group ref={group}>
      <group ref={inner} scale={0}>
        {/* glow halo */}
        <sprite scale={[r * 7, r * 7, 1]}>
          <spriteMaterial map={textures.glow} color={hex} transparent opacity={dimmed ? 0.12 : 0.38} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
        {/* core */}
        <mesh onPointerOver={over} onPointerOut={out} onClick={click}>
          <sphereGeometry args={[r, 24, 24]} />
          <meshBasicMaterial color={coreColor} toneMapped={false} transparent opacity={dimmed ? 0.5 : 1} />
        </mesh>
        {/* bigger invisible hit area so hovering is easy */}
        <mesh onPointerOver={over} onPointerOut={out} onClick={click} visible={false}>
          <sphereGeometry args={[r * 2.2, 8, 8]} />
          <meshBasicMaterial />
        </mesh>
      </group>

      <sprite ref={ringRef} visible={false}>
        <spriteMaterial map={textures.ring} color={hex} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={pulseRef} visible={false}>
        <spriteMaterial map={textures.ring} color="#e2e8f0" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

    </group>
  );
}

// ── Links + pulses ───────────────────────────────────────────────────────────

function linkColor(l: Link, a: Body | undefined, b: Body | undefined, dim: boolean, lit: boolean) {
  let c: THREE.Color;
  let k: number;
  if (l.kind === "path") {
    c = new THREE.Color(SEVERITY_COLOR[b?.severity ?? "none"]).lerp(new THREE.Color(SEVERITY_COLOR[a?.severity ?? "none"]), 0.5);
    k = lit ? 2.2 : 1.35;
  } else if (l.kind === "entry") {
    c = new THREE.Color("#cbd5e1");
    k = lit ? 0.9 : 0.35;
  } else {
    c = new THREE.Color("#64748b");
    k = lit ? 0.6 : 0.2;
  }
  if (dim) k *= 0.18;
  return c.multiplyScalar(k);
}

function Links({ links, sim, hoverId }: { links: Link[]; sim: React.MutableRefObject<Map<string, Body>>; hoverId: string | null }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    return g;
  }, [links]);

  useFrame(() => {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const now = performance.now();
    links.forEach((l, i) => {
      const a = sim.current.get(l.a);
      const b = sim.current.get(l.b);
      if (!a || !b) return;
      // lines grow out from the older star to the newer one as it is born
      const age = Math.min(now - a.born, now - b.born);
      const reveal = Math.min(1, Math.max(0, age) / 700);
      const ex = a.x + (b.x - a.x) * reveal;
      const ey = a.y + (b.y - a.y) * reveal;
      const ez = a.z + (b.z - a.z) * reveal;
      pos.setXYZ(i * 2, a.x, a.y, a.z);
      pos.setXYZ(i * 2 + 1, ex, ey, ez);
      const touches = hoverId !== null && (l.a === hoverId || l.b === hoverId);
      const dim = hoverId !== null && !touches;
      const c = linkColor(l, a, b, dim, touches);
      col.setXYZ(i * 2, c.r, c.g, c.b);
      col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial vertexColors transparent opacity={0.95} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

function Pulses({ links, sim, reduce }: { links: Link[]; sim: React.MutableRefObject<Map<string, Body>>; reduce: boolean }) {
  const paths = useMemo(() => links.filter((l) => l.kind === "path"), [links]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const colorRef = useMemo(() => new THREE.Color("#ffffff").multiplyScalar(3), []);

  useFrame((state) => {
    const im = mesh.current;
    if (!im) return;
    const t = state.clock.elapsedTime;
    paths.forEach((l, i) => {
      const a = sim.current.get(l.a);
      const b = sim.current.get(l.b);
      if (!a || !b) return;
      const p = reduce ? 0.5 : (t * 0.3 + i * 0.37) % 1;
      m.makeTranslation(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, a.z + (b.z - a.z) * p);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  });

  if (!paths.length || reduce) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, paths.length]} key={paths.length}>
      <sphereGeometry args={[0.075, 10, 10]} />
      <meshBasicMaterial color={colorRef} toneMapped={false} />
    </instancedMesh>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
//
// Labels are plain HTML positioned over the canvas. Every frame we project
// each star's 3D position to screen space and move its div there.

type LabelMap = () => Map<string, HTMLDivElement>;

function LabelProjector({ sim, labels }: { sim: React.MutableRefObject<Map<string, Body>>; labels: LabelMap }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const [id, el] of labels()) {
      const b = sim.current.get(id);
      if (!b) {
        el.style.opacity = "0";
        continue;
      }
      v.set(b.x, b.y - b.r - 0.25, b.z).project(camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const dist = camera.position.distanceTo(new THREE.Vector3(b.x, b.y, b.z));
      const scale = Math.max(0.55, Math.min(1.25, 12 / dist));
      const age = Math.max(0, performance.now() - b.born);
      const fade = Math.min(1, age / 900);
      el.style.transform = `translate(-50%, 0) translate(${x}px, ${y}px) scale(${scale})`;
      el.style.opacity = behind ? "0" : String(fade);
    }
  });
  return null;
}

// ── Scene ────────────────────────────────────────────────────────────────────

interface SceneProps {
  graph: Graph;
  isRunning: boolean;
  reduce: boolean;
  hoverId: string | null;
  focusId: string | null;
  setHoverId: (id: string | null) => void;
  onStarClick: (star: Graph["stars"][number]) => void;
  labels: LabelMap;
}

function Scene({ graph, isRunning, reduce, hoverId, focusId, setHoverId, onStarClick, labels }: SceneProps) {
  const sim = useRef<Map<string, Body>>(new Map());
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const textures = useTextures();
  const dest = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  // Keep the simulation bodies in step with the graph. Existing stars keep
  // their positions, new ones are born near the target.
  useEffect(() => {
    const next = new Map<string, Body>();
    const now = performance.now();
    for (const s of graph.stars) {
      const old = sim.current.get(s.id);
      if (old) {
        old.severity = s.severity;
        old.r = s.kind === "waypoint" ? 0.13 : RADIUS[s.severity];
        next.set(s.id, old);
        continue;
      }
      const theta = Math.random() * Math.PI * 2;
      const dist = s.kind === "target" ? 0 : 1.2 + Math.random() * 1.5;
      next.set(s.id, {
        id: s.id,
        kind: s.kind,
        severity: s.severity,
        x: Math.cos(theta) * dist,
        y: Math.sin(theta) * dist,
        z: (Math.random() - 0.5) * 0.6,
        vx: 0,
        vy: 0,
        vz: 0,
        born: s.kind === "target" ? now - 5000 : now,
        r: s.kind === "waypoint" ? 0.13 : RADIUS[s.severity],
      });
    }
    sim.current = next;
  }, [graph]);

  useFrame((_, dt) => {
    const bodies = Array.from(sim.current.values());
    stepPhysics(bodies, graph.links, Math.min(3, Math.max(1, Math.round(dt * 60))));

    // Camera: drift the orbit target toward the focused star (or back home).
    const c = controls.current;
    if (!c) return;
    const focus = focusId ? sim.current.get(focusId) : undefined;
    if (focus) {
      dest.set(focus.x, focus.y, focus.z);
      c.target.lerp(dest, 0.08);
      tmp.copy(camera.position).sub(c.target).normalize().multiplyScalar(6.5).add(c.target);
      camera.position.lerp(tmp, 0.05);
    } else {
      c.target.lerp(ORIGIN, 0.06);
    }
    c.update();
  });

  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!hoverId) return set;
    for (const l of graph.links) {
      if (l.a === hoverId) set.add(l.b);
      if (l.b === hoverId) set.add(l.a);
    }
    return set;
  }, [graph.links, hoverId]);

  return (
    <>
      <color attach="background" args={["#02040c"]} />
      <Nebulae glow={textures.glow} />
      <BackgroundStars reduce={reduce} dot={textures.dot} />

      <LabelProjector sim={sim} labels={labels} />
      <Links links={graph.links} sim={sim} hoverId={hoverId} />
      <Pulses links={graph.links} sim={sim} reduce={reduce} />
      {graph.stars.map((s) => (
        <StarNode
          key={s.id}
          star={s}
          sim={sim}
          hovered={hoverId === s.id}
          dimmed={hoverId !== null && hoverId !== s.id && !connected.has(s.id)}
          reduce={reduce}
          isRunning={isRunning}
          textures={textures}
          onHover={setHoverId}
          onClick={onStarClick}
        />
      ))}

      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.5}
        minDistance={4}
        maxDistance={26}
        autoRotate={!reduce && !focusId && !hoverId}
        autoRotateSpeed={0.4}
        makeDefault
      />

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.7} luminanceSmoothing={0.2} radius={0.7} />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

interface Props {
  scan: ScanState;
  onSelect?: (finding: Finding) => void;
  className?: string;
}

export function AttackSky({ scan, onSelect, className }: Props) {
  const reduce = useReducedMotion() ?? false;
  const graph = useMemo(() => buildGraph(scan), [scan]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const isRunning = scan.status === "running" || scan.status === "pending";
  const labels = useRef<Map<string, HTMLDivElement>>(new Map());
  const getLabels = useCallback(() => labels.current, []);

  const connected = useMemo(() => {
    const set = new Set<string>();
    if (!hoverId) return set;
    for (const l of graph.links) {
      if (l.a === hoverId) set.add(l.b);
      if (l.b === hoverId) set.add(l.a);
    }
    return set;
  }, [graph.links, hoverId]);

  useEffect(() => {
    document.body.style.cursor = hoverId ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hoverId]);

  const onStarClick = (star: Graph["stars"][number]) => {
    setFocusId((cur) => (cur === star.id && star.kind === "target" ? null : star.id));
    if (star.finding && onSelect) onSelect(star.finding);
  };

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ position: [0, 2.5, 13], fov: 50, near: 0.1, far: 400 }}
        onPointerMissed={() => setFocusId(null)}
      >
        <Scene
          graph={graph}
          isRunning={isRunning}
          reduce={reduce}
          hoverId={hoverId}
          focusId={focusId}
          setHoverId={setHoverId}
          onStarClick={onStarClick}
          labels={getLabels}
        />
      </Canvas>

      {/* Label layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {graph.stars.map((s) => {
          const hovered = hoverId === s.id;
          const dimmed = hoverId !== null && !hovered && !connected.has(s.id);
          const hex = SEVERITY_COLOR[s.severity];
          const f = s.finding;
          if (s.kind === "waypoint" && !hovered) return null;
          return (
            <div
              key={s.id}
              ref={(el) => {
                if (el) labels.current.set(s.id, el);
                else labels.current.delete(s.id);
              }}
              className="absolute left-0 top-0 origin-top will-change-transform"
              style={{ opacity: 0, zIndex: hovered ? 30 : 10 }}
            >
              {hovered && f ? (
                <div className="w-[270px] rounded-xl border border-white/15 bg-[#05091a]/90 p-3 text-left shadow-2xl backdrop-blur-md">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: hex, boxShadow: `0 0 10px ${hex}` }} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-300">
                      {f.severity} · {f.tool}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] font-semibold leading-snug text-white">{f.title}</p>
                  {f.component && <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{f.component}</p>}
                  <p className="mt-2 text-[10px] text-cyan-200">Click to see the fix</p>
                </div>
              ) : (
                <span
                  className={`block whitespace-nowrap font-mono transition-opacity ${
                    s.kind === "target"
                      ? "text-[13px] font-semibold text-slate-100"
                      : hovered
                        ? "text-[13px] font-semibold text-white"
                        : "text-[12px] text-slate-300/85"
                  } ${dimmed ? "opacity-30" : ""}`}
                  style={{ textShadow: "0 1px 10px rgba(0,0,0,0.95)" }}
                >
                  {s.label.length > 36 && !hovered ? `${s.label.slice(0, 35)}…` : s.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function skyStats(scan: ScanState) {
  const graph = buildGraph(scan);
  return {
    stars: graph.stars.filter((s) => s.kind === "finding").length,
    paths: graph.links.filter((l) => l.kind === "path").length,
    chainSource: graph.chainSource,
  };
}
