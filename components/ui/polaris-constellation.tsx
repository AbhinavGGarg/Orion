/* Adapted from Polaris components/attack-sky.tsx, MIT.
   Copyright (c) 2026 Siddharth Shringarpure. See POLARIS-LICENSE.txt. */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { constellationAgents, type SkyGraph, type SkyNode } from "@/lib/constellation-model";

const COLORS: Record<string, string> = {
  breach: "#f87171", high: "#fb923c", medium: "#fbbf24", context: "#a5b4fc", none: "#e2e8f0",
};
const RADII: Record<string, number> = { breach: 0.3, high: 0.25, medium: 0.21, context: 0.17, none: 0.3 };
const AGENT_COLORS = { scout: "#7dd3fc", analyst: "#c4b5fd", fixer: "#6ee7b7" };
const AGENT_TASKS = ["Locating the source", "Reviewing evidence", "Previewing the fix"];

interface Body {
  node: SkyNode;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  group: THREE.Group;
  core: THREE.Mesh;
  radius: number;
  phase: number;
}

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

function stepPhysics(bodies: Body[], links: SkyGraph["links"]) {
  const byId = new Map(bodies.map(body => [body.node.id, body]));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.node.agent || b.node.agent) continue;
      const delta = b.position.clone().sub(a.position);
      const distance = Math.max(0.05, delta.length());
      if (distance >= 4.6) continue;
      delta.multiplyScalar(((4.6 - distance) / 4.6) * 0.05 / distance);
      a.velocity.sub(delta);
      b.velocity.add(delta);
    }
  }
  for (const link of links) {
    const a = byId.get(link.a), b = byId.get(link.b);
    if (!a || !b || a.node.agent || b.node.agent) continue;
    const delta = b.position.clone().sub(a.position);
    const distance = Math.max(0.05, delta.length());
    delta.multiplyScalar((distance - 3.8) * 0.02 / distance);
    a.velocity.add(delta);
    b.velocity.sub(delta);
  }
  for (const body of bodies) {
    if (body.node.agent) continue;
    if (body.node.id === "target") {
      body.position.set(0, 0, 0);
      body.velocity.set(0, 0, 0);
      continue;
    }
    body.velocity.x -= body.position.x * 0.002;
    body.velocity.y -= body.position.y * 0.002;
    body.velocity.z -= body.position.z * 0.012;
    body.velocity.multiplyScalar(0.9);
    body.position.add(body.velocity).clampLength(0, 7.5);
  }
}

function radialTexture(stops: [number, string][], size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Props { graph: SkyGraph; onSelect: (id: string) => void }
interface Controls { update: () => void; redraw: () => void; reset: () => void; zoom: (scale: number) => void }

export default function PolarisConstellation({ graph, onSelect }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLButtonElement>());
  const engine = useRef<Controls | null>(null);
  const sceneGraph = useMemo(() => ({ ...graph,
    nodes: [...graph.nodes, ...constellationAgents],
    links: [...graph.links, ...constellationAgents.map(agent => ({ a: agent.id, b: "target" }))],
  }), [graph]);
  const graphRef = useRef(sceneGraph);
  const selectRef = useRef<(node: SkyNode) => void>(() => {});
  const [selected, setSelected] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [fixed, setFixed] = useState<string[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [phase, setPhase] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [motionPaused, setMotionPaused] = useState(() => document.documentElement.dataset.motion === "off");
  const currentFinding = graph.nodes.find(node => node.id !== "target" && node.severity !== "context" && !fixed.includes(node.id));
  const simulation = useRef({ running: false, phase: 0, target: "" });
  simulation.current = { running: simulating, phase, target: currentFinding?.id || "" };
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
  graphRef.current = sceneGraph;
  selectRef.current = async node => {
    setSelected(node.id);
    if (node.findingId) {
      if (document.fullscreenElement === root.current) {
        try { await document.exitFullscreen(); }
        catch { setFullscreenError("Exit fullscreen to open this finding's evidence."); return; }
      }
      onSelect(node.findingId);
    }
  };

  useEffect(() => {
    const onFullscreen = () => {
      const active = document.fullscreenElement === root.current;
      setFullscreen(active);
      if (!active) fullscreenButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && document.fullscreenElement === root.current) {
        document.exitFullscreen().catch(() => {
          if (document.fullscreenElement === root.current) setFullscreenError("Use Exit fullscreen to close this view.");
        });
      }
    };
    document.addEventListener("keydown", onKey);
    const onMotion = () => setMotionPaused(document.documentElement.dataset.motion === "off");
    document.addEventListener("polaris:motion", onMotion);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("polaris:motion", onMotion);
    };
  }, []);

  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen is unavailable here. Open this preview directly in a browser and try again.");
    }
  }

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    } catch {
      setUnavailable(true);
      return;
    }
    host.prepend(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Interactive constellation. Drag to orbit and scroll to zoom.");
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#02040c");
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    camera.position.set(0, 2.5, 15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;
    controls.minDistance = 5;
    controls.maxDistance = 30;
    controls.autoRotateSpeed = 0.4;
    controls.dampingFactor = 0.06;
    controls.update();
    controls.saveState();
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.7, 0.7);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(outputPass);
    const glow = radialTexture([[0, "#ffffff"], [0.25, "rgba(255,255,255,.45)"], [0.6, "rgba(255,255,255,.08)"], [1, "rgba(255,255,255,0)"]]);
    const dot = radialTexture([[0, "#ffffff"], [0.4, "rgba(255,255,255,.6)"], [1, "rgba(255,255,255,0)"]], 64);
    const sphere = new THREE.SphereGeometry(1, 24, 24);
    const stars = new THREE.Group();
    scene.add(stars);
    const starFields: THREE.Points[] = [];
    for (const [count, min, max, seed, size, opacity] of [[2600, 45, 95, 7, 0.55, 0.75], [500, 14, 32, 11, 0.18, 0.55]]) {
      const random = seededRandom(seed);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const radius = min + random() * (max - min);
        const theta = random() * Math.PI * 2;
        const phi = Math.acos(2 * random() - 1);
        positions.set([radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)], i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const field = new THREE.Points(geometry, new THREE.PointsMaterial({ map: dot, size, color: "#dbe4ff", transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      starFields.push(field);
      scene.add(field);
    }
    for (const [x, y, z, scale, color] of [[-14, 6, -30, 42, "#4338ca"], [16, -4, -36, 48, "#0e7490"]] as const) {
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
      cloud.position.set(x, y, z);
      cloud.scale.set(scale, scale, 1);
      scene.add(cloud);
    }

    let bodies: Body[] = [];
    let lines: { a: Body; b: Body; geometry: THREE.BufferGeometry; pulse: THREE.Mesh; material: THREE.LineBasicMaterial }[] = [];
    let frame = 0, last = 0, elapsed = 0, accumulator = 0;
    let visible = false, disposed = false;
    let width = 1, height = 1;
    const projected = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = { x: 0, y: 0 };
    const paused = () => document.documentElement.dataset.motion === "off";

    function releaseStars() {
      stars.traverse(object => {
        const drawable = object as THREE.Mesh;
        if (drawable.geometry && drawable.geometry !== sphere) drawable.geometry.dispose();
        if (drawable.material) for (const material of [drawable.material].flat()) material.dispose();
      });
      stars.clear();
    }

    function update() {
      const previous = new Map(bodies.map(body => [body.node.id, body]));
      releaseStars();
      const random = seededRandom(17);
      bodies = graphRef.current.nodes.map(node => {
        const old = previous.get(node.id);
        const angle = random() * Math.PI * 2;
        const radius = RADII[node.severity] ?? 0.13;
        const color = node.agent ? AGENT_COLORS[node.agent] : COLORS[node.severity] ?? "#94a3b8";
        const group = new THREE.Group();
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.scale.set(radius * 7, radius * 7, 1);
        const coreColor = new THREE.Color(color).lerp(new THREE.Color("white"), node.id === "target" ? 0.85 : 0.12).multiplyScalar(node.id === "target" ? 2.4 : 1.5);
        const core = new THREE.Mesh(node.agent ? new THREE.OctahedronGeometry(1) : sphere, new THREE.MeshBasicMaterial({ color: coreColor, toneMapped: false }));
        core.scale.setScalar(radius);
        core.userData.node = node;
        group.add(halo, core);
        if (node.agent) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.012, 6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }));
          ring.rotation.x = 0.5;
          group.add(ring);
        }
        stars.add(group);
        const agentIndex = constellationAgents.findIndex(agent => agent.id === node.id);
        return { node, group, core, radius, phase: angle,
          position: old?.position ?? (node.agent ? new THREE.Vector3((agentIndex - 1) * 5, 5, -1) : new THREE.Vector3(Math.cos(angle) * 3, Math.sin(angle) * 3, random() - 0.5)),
          velocity: old?.velocity ?? new THREE.Vector3() };
      });
      // Settle the layout before drawing, including when motion starts paused.
      for (let i = 0; i < 120; i++) stepPhysics(bodies, graphRef.current.links);
      const byId = new Map(bodies.map(body => [body.node.id, body]));
      lines = [];
      for (const link of graphRef.current.links) {
        const a = byId.get(link.a), b = byId.get(link.b);
        if (!a || !b) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        const material = new THREE.LineBasicMaterial({ color: a.node.agent ? AGENT_COLORS[a.node.agent] : "#a8b8d3", transparent: true, opacity: a.node.agent ? 0.12 : 0.32, depthWrite: false });
        stars.add(new THREE.Line(geometry, material));
        const pulse = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }));
        pulse.scale.setScalar(0.045);
        stars.add(pulse);
        lines.push({ a, b, geometry, pulse, material });
      }
      requestFrame();
    }

    function draw(now: number) {
      frame = 0;
      if (disposed || (!visible && document.fullscreenElement !== root.current) || document.hidden) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const still = paused();
      if (!still) {
        elapsed += dt;
        accumulator += dt;
        while (accumulator >= 1 / 60) {
          stepPhysics(bodies, graphRef.current.links);
          accumulator -= 1 / 60;
        }
        starFields[0].rotation.y += dt * 0.006;
        starFields[1].rotation.y -= dt * 0.01;
      }
      controls.autoRotate = !still;
      controls.enableDamping = !still;
      controls.update(dt);
      const activeAgent = simulation.current.running ? constellationAgents[simulation.current.phase].id : "";
      const target = bodies.find(body => body.node.id === simulation.current.target);
      for (const body of bodies) {
        if (body.node.agent && !still) {
          body.core.rotation.y += dt * 0.7;
          body.group.children[2].rotation.z += dt * 0.3;
        }
        body.group.position.copy(body.position);
        body.group.scale.setScalar(still ? 1 : 1 + 0.06 * Math.sin(elapsed * 2.3 + body.phase));
        const simulated = fixedRef.current.includes(body.node.id);
        const color = simulated ? "#6ee7b7" : body.node.agent ? AGENT_COLORS[body.node.agent] : COLORS[body.node.severity] ?? "#94a3b8";
        const core = body.core.material as THREE.MeshBasicMaterial;
        core.color.set(color).lerp(new THREE.Color("white"), body.node.id === "target" ? 0.85 : 0.12).multiplyScalar(body.node.id === "target" ? 2.4 : 1.5);
        (body.group.children[0] as THREE.Sprite).material.color.set(color);
        if (body.node.agent) (body.group.children[0] as THREE.Sprite).material.opacity = body.node.id === activeAgent ? 0.85 : 0.3;
      }
      for (const line of lines) {
        const working = line.a.node.id === activeAgent && !!target;
        const end = working ? target!.position : line.b.position;
        const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.setXYZ(0, line.a.position.x, line.a.position.y, line.a.position.z);
        positions.setXYZ(1, end.x, end.y, end.z);
        positions.needsUpdate = true;
        line.pulse.position.lerpVectors(line.a.position, end, (elapsed * (working ? 1.1 : 0.3) + line.b.phase) % 1);
        line.pulse.visible = !line.a.node.agent || working;
        if (line.a.node.agent) line.material.opacity = working ? 0.75 : 0.12;
        (line.pulse.material as THREE.MeshBasicMaterial).color.set(fixedRef.current.includes(line.b.node.id) ? "#6ee7b7" : "#ffffff");
      }
      composer.render();
      for (const body of bodies) {
        const label = labels.current.get(body.node.id);
        if (!label) continue;
        projected.copy(body.position);
        projected.y -= body.radius + 0.28;
        projected.project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.style.visibility = projected.z > 1 || x < 0 || x > width || y < 0 || y > height ? "hidden" : "visible";
      }
      host!.dataset.webgl = "ready";
      if (!still) requestFrame();
    }

    function requestFrame() {
      if (!frame && !disposed && (visible || document.fullscreenElement === root.current) && !document.hidden) frame = requestAnimationFrame(draw);
    }
    function syncMotion() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = performance.now();
      accumulator = 0;
      requestFrame();
    }
    function resize() {
      const rect = host!.getBoundingClientRect();
      visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
      width = Math.max(1, host!.clientWidth);
      height = Math.max(1, host!.clientHeight);
      const dpr = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2.5e6 / (width * height)));
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / Math.min(1, camera.aspect)));
      camera.updateProjectionMatrix();
      syncMotion();
    }
    const down = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(bodies.map(body => body.core))[0];
      if (hit) selectRef.current(hit.object.userData.node as SkyNode);
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    controls.addEventListener("change", requestFrame);
    document.addEventListener("polaris:motion", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    document.addEventListener("fullscreenchange", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); });
    intersection.observe(host);
    engine.current = {
      update, redraw: requestFrame,
      reset: () => { controls.reset(); requestFrame(); },
      zoom: scale => { camera.position.sub(controls.target).multiplyScalar(scale).clampLength(5, 30).add(controls.target); controls.update(); requestFrame(); },
    };
    resize();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      controls.dispose();
      document.removeEventListener("polaris:motion", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      document.removeEventListener("fullscreenchange", resize);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointerup", up);
      scene.traverse(object => {
        const drawable = object as THREE.Mesh;
        drawable.geometry?.dispose();
        if (drawable.material) for (const material of [drawable.material].flat()) material.dispose();
      });
      glow.dispose(); dot.dispose(); sphere.dispose();
      bloom.dispose(); renderPass.dispose(); outputPass.dispose(); composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      engine.current = null;
    };
  }, []);

  useEffect(() => { engine.current?.update(); }, [sceneGraph]);
  useEffect(() => {
    if (!simulating) return;
    const remaining = graph.nodes.filter(node => node.id !== "target" && node.severity !== "context" && !fixed.includes(node.id));
    if (!remaining.length) { setSimulating(false); return; }
    const timer = window.setTimeout(() => {
      if (phase < constellationAgents.length - 1) setPhase(current => current + 1);
      else { setFixed(current => [...current, remaining[0].id]); setPhase(0); }
    }, 800);
    return () => clearTimeout(timer);
  }, [simulating, fixed, graph, phase]);
  useEffect(() => { engine.current?.redraw(); }, [fixed, phase, simulating]);
  const active = sceneGraph.nodes.find(node => node.id === selected);
  return <div className="polaris-constellation" ref={root}>
    <div className="sky-toolbar">
      <span>{graph.demo ? "Interactive demo" : "Your scan in 3D"}</span>
      <button type="button" disabled={simulating || !graph.nodes.some(node => node.id !== "target" && node.severity !== "context")}
        onClick={() => { setFixed([]); setPhase(0); setSimulating(true); }}>{simulating ? "Previewing fixes…" : "Simulate fixes"}</button>
      {!!fixed.length && <button type="button" onClick={() => { setSimulating(false); setFixed([]); }}>Reset simulation</button>}
      <button type="button" ref={fullscreenButton} aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      {fullscreen && <button type="button" onClick={() => document.querySelector<HTMLButtonElement>(".motion-control")?.click()}>{motionPaused ? "Resume motion" : "Pause motion"}</button>}
    </div>
    {fullscreenError && <p className="sky-simulation" role="alert">{fullscreenError}</p>}
    <div className="sky-viewport" ref={viewport}>
      <div className="sky-labels" aria-label="Constellation stars">
        {!unavailable && sceneGraph.nodes.map(node => <button key={node.id} type="button"
          className={node.agent ? "sky-label sky-agent-label" : node.id === "target" ? "sky-label sky-target" : "sky-label"}
          ref={element => { if (element) labels.current.set(node.id, element); else labels.current.delete(node.id); }}
          title={node.label} aria-label={`${node.findingId ? "View evidence: " : "Explore: "}${node.label}`}
          onClick={() => selectRef.current(node)}>{node.label}{node.agent && <span className="sky-agent-tag">Simulation agent</span>}{fixed.includes(node.id) && <span className="sky-fixed">Fix simulated</span>}</button>)}
      </div>
      {unavailable && <div className="sky-fallback"><p>The 3D view is unavailable in this browser. Explore the same stars below.</p>
        {sceneGraph.nodes.map(node => <button type="button" key={node.id} onClick={() => selectRef.current(node)}>{node.label}</button>)}
      </div>}
      {!unavailable && <div className="sky-controls">
        <button type="button" aria-label="Zoom in" onClick={() => engine.current?.zoom(0.8)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => engine.current?.zoom(1.25)}>−</button>
        <button type="button" onClick={() => engine.current?.reset()}>Reset view</button>
      </div>}
    </div>
    <div className="sky-agents" aria-label="Simulated agents">
      {constellationAgents.map((agent, index) => <button type="button" key={agent.id}
        className={simulating && phase === index ? "sky-agent is-working" : "sky-agent"}
        onClick={() => selectRef.current(agent)}>
        <span className="sky-agent-dot" style={{ background: AGENT_COLORS[agent.agent!] }} />
        <strong>{agent.label}</strong><span>{simulating && phase === index ? AGENT_TASKS[index] : fixed.length && !simulating ? "Preview complete" : "Simulation ready"}</span>
      </button>)}
    </div>
    <div className="sky-caption"><span>{graph.caption}</span><span>Drag to orbit · Scroll to zoom</span></div>
    {(simulating || !!fixed.length) && <p className="sky-simulation" role="status">Fix preview: {fixed.length} simulated. No files or saved findings have changed. Run a new scan after applying a fix to verify it.</p>}
    {active && <p className="sky-detail" role="status"><strong>{active.label}</strong>{active.detail}</p>}
  </div>;
}
