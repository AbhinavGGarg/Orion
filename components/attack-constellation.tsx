"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useReducedMotion } from "motion/react";
import { Finding, ScanState, Severity } from "@/types/scan";
import {
  buildGraph,
  hexToRgba,
  SEVERITY_COLOR,
  SEVERITY_RADIUS,
  type Link,
  type StarKind,
} from "@/components/constellation-graph";

interface Star {
  id: string;
  kind: StarKind;
  label: string;
  severity: Severity | "none";
  finding?: Finding;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  pinned: boolean;
  phase: number;
  r: number;
}

// Rest lengths as a fraction of the shorter canvas side, so the constellation
// fills the panel at any size.
const REST_FRACTION: Record<Link["kind"], number> = {
  path: 0.3,
  entry: 0.34,
  component: 0.22,
};

// ── Physics ──────────────────────────────────────────────────────────────────
//
// A small force simulation, written by hand so it stays explainable:
//   1. every star pushes every other star away (so they spread out)
//   2. every link pulls its two stars toward a rest distance (so paths stay tight)
//   3. everything drifts gently toward the centre (so nothing flies off)

function stepPhysics(stars: Star[], links: Link[], w: number, h: number, dt: number) {
  const cx = w / 2;
  const cy = h / 2;
  const n = stars.length;
  const scale = Math.max(200, Math.min(w, h));
  const index = new Map<string, Star>();
  for (const s of stars) index.set(s.id, s);

  for (let i = 0; i < n; i++) {
    const a = stars[i];
    for (let j = i + 1; j < n; j++) {
      const b = stars[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const reach = scale * 0.5;
      if (d < reach) {
        const f = ((reach - d) / reach) * 1.1;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  for (const l of links) {
    const a = index.get(l.a);
    const b = index.get(l.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const rest = REST_FRACTION[l.kind] * scale;
    const k = l.kind === "component" ? 0.01 : 0.025;
    const f = (d - rest) * k;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const s of stars) {
    if (s.kind === "target") {
      s.x += (cx - s.x) * 0.2;
      s.y += (cy - s.y) * 0.2;
      s.vx = 0;
      s.vy = 0;
      continue;
    }
    if (s.pinned) {
      s.vx = 0;
      s.vy = 0;
      continue;
    }
    s.vx += (cx - s.x) * 0.0012;
    s.vy += (cy - s.y) * 0.0012;
    s.vx *= 0.84;
    s.vy *= 0.84;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > 6) {
      s.vx = (s.vx / speed) * 6;
      s.vy = (s.vy / speed) * 6;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const padX = 110;
    const padY = 56;
    if (s.x < padX) s.x = padX;
    if (s.x > w - padX) s.x = w - padX;
    if (s.y < padY) s.y = padY;
    if (s.y > h - padY - 10) s.y = h - padY - 10;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  scan: ScanState;
  onSelect?: (finding: Finding) => void;
  className?: string;
}

export function AttackConstellation({ scan, onSelect, className }: Props) {
  const reduce = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const starsRef = useRef<Star[]>([]);
  const linksRef = useRef<Link[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const bgRef = useRef<{ x: number; y: number; r: number; p: number }[]>([]);
  const [hover, setHover] = useState<{ star: Star; x: number; y: number; w: number; h: number } | null>(null);

  const graph = useMemo(() => buildGraph(scan), [scan]);
  const isRunning = scan.status === "running" || scan.status === "pending";
  const findingCount = graph.stars.filter((s) => s.kind === "finding").length;
  const pathCount = graph.links.filter((l) => l.kind === "path").length;

  // Merge graph changes into the live star list. Existing stars keep their
  // positions so the picture never jumps; new stars are born near the centre.
  useEffect(() => {
    const { w, h } = sizeRef.current;
    const cx = (w || 800) / 2;
    const cy = (h || 520) / 2;
    const prev = new Map(starsRef.current.map((s) => [s.id, s]));
    const now = performance.now();
    const next: Star[] = graph.stars.map((g) => {
      const old = prev.get(g.id);
      if (old) {
        old.label = g.label;
        old.severity = g.severity;
        old.finding = g.finding;
        old.r = g.kind === "waypoint" ? 3.5 : SEVERITY_RADIUS[g.severity];
        return old;
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = g.kind === "target" ? 0 : 80 + Math.random() * 140;
      return {
        id: g.id,
        kind: g.kind,
        label: g.label,
        severity: g.severity,
        finding: g.finding,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        born: g.kind === "target" ? now - 5000 : now,
        pinned: false,
        phase: Math.random() * Math.PI * 2,
        r: g.kind === "waypoint" ? 3.5 : SEVERITY_RADIUS[g.severity],
      };
    });
    starsRef.current = next;
    linksRef.current = graph.links;
  }, [graph]);

  // Resize + render loop.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const makeBackground = (w: number, h: number) => {
      const count = Math.floor((w * h) / 2600);
      bgRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2,
        p: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      makeBackground(rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const { w, h } = sizeRef.current;
      const dt = Math.min(2, (now - last) / 16.67);
      last = now;
      const stars = starsRef.current;
      const links = linksRef.current;
      const hovered = hoverRef.current;
      const byId = new Map(stars.map((s) => [s.id, s]));
      const t = reduce ? 0 : now / 1000;

      if (!reduce || stars.some((s) => Math.hypot(s.vx, s.vy) > 0.01)) {
        stepPhysics(stars, links, w, h, dt);
      }

      ctx.clearRect(0, 0, w, h);

      // Deep-space vignette.
      const vg = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w, h) * 0.7);
      vg.addColorStop(0, "rgba(56,189,248,0.07)");
      vg.addColorStop(0.5, "rgba(15,23,42,0)");
      vg.addColorStop(1, "rgba(2,6,23,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // Background stars (twinkle).
      for (const b of bgRef.current) {
        const tw = reduce ? 0.6 : 0.45 + 0.4 * Math.sin(t * 1.3 + b.p);
        ctx.fillStyle = `rgba(226,232,240,${tw * 0.55})`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const connected = new Set<string>();
      if (hovered) {
        for (const l of links) {
          if (l.a === hovered) connected.add(l.b);
          if (l.b === hovered) connected.add(l.a);
        }
      }

      // Links.
      links.forEach((l, i) => {
        const a = byId.get(l.a);
        const b = byId.get(l.b);
        if (!a || !b) return;
        const age = Math.max(0, Math.min(now - a.born, now - b.born));
        const reveal = reduce ? 1 : Math.min(1, age / 700);
        const touchesHover = hovered && (l.a === hovered || l.b === hovered);
        const dim = hovered && !touchesHover;

        const ex = a.x + (b.x - a.x) * reveal;
        const ey = a.y + (b.y - a.y) * reveal;

        if (l.kind === "component") {
          ctx.strokeStyle = `rgba(148,163,184,${dim ? 0.05 : touchesHover ? 0.35 : 0.12})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 5]);
        } else if (l.kind === "entry") {
          ctx.strokeStyle = `rgba(226,232,240,${dim ? 0.06 : touchesHover ? 0.55 : 0.22})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        } else {
          const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          grad.addColorStop(0, hexToRgba(SEVERITY_COLOR[a.severity], dim ? 0.12 : 0.7));
          grad.addColorStop(1, hexToRgba(SEVERITY_COLOR[b.severity], dim ? 0.12 : 0.7));
          ctx.strokeStyle = grad;
          ctx.lineWidth = touchesHover ? 2.2 : 1.5;
          ctx.setLineDash([]);
          if (!dim) {
            ctx.shadowColor = hexToRgba(SEVERITY_COLOR[b.severity], 0.6);
            ctx.shadowBlur = 8;
          }
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        // Signal pulse travelling along attack paths (the "neural" bit).
        if (l.kind === "path" && !reduce && reveal >= 1 && !dim) {
          const p = (t * 0.45 + i * 0.37) % 1;
          const px = a.x + (b.x - a.x) * p;
          const py = a.y + (b.y - a.y) * p;
          const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
          pg.addColorStop(0, "rgba(255,255,255,0.95)");
          pg.addColorStop(0.4, hexToRgba(SEVERITY_COLOR[b.severity], 0.6));
          pg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fill();
        }

        // Path label when hovering either end.
        if (l.kind === "path" && touchesHover && l.label) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
          ctx.textAlign = "center";
          const tw = ctx.measureText(l.label).width + 10;
          ctx.fillStyle = "rgba(2,6,23,0.85)";
          ctx.fillRect(mx - tw / 2, my - 14, tw, 14);
          ctx.fillStyle = "rgba(226,232,240,0.9)";
          ctx.fillText(l.label, mx, my - 4);
        }
      });

      // Stars.
      for (const s of stars) {
        const color = SEVERITY_COLOR[s.severity];
        const age = Math.max(0, now - s.born);
        const birth = reduce ? 1 : Math.min(1, age / 900);
        const ease = 1 - Math.pow(1 - birth, 3);
        const twinkle = reduce ? 1 : 0.85 + 0.15 * Math.sin(t * 2.1 + s.phase);
        const isHover = hovered === s.id;
        const isNeighbour = connected.has(s.id);
        const dim = hovered && !isHover && !isNeighbour;
        const r = s.r * ease * (isHover ? 1.35 : 1);
        const alpha = dim ? 0.35 : 1;

        // Birth ring.
        if (!reduce && age < 1200 && s.kind !== "target") {
          const k = age / 1200;
          ctx.strokeStyle = hexToRgba(color, (1 - k) * 0.8);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 6 + k * 46, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Glow.
        const glowR = Math.max(1, r * (s.kind === "target" ? 5 : 4) * twinkle);
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
        g.addColorStop(0, hexToRgba(color, 0.55 * alpha));
        g.addColorStop(0.35, hexToRgba(color, 0.18 * alpha));
        g.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // Core.
        ctx.fillStyle = s.kind === "waypoint" ? hexToRgba("#cbd5e1", 0.7 * alpha) : hexToRgba("#ffffff", 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1.2, r * 0.55), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexToRgba(color, 0.9 * alpha);
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(1.6, r * 0.8), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexToRgba("#ffffff", 0.95 * alpha);
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0.8, r * 0.4), 0, Math.PI * 2);
        ctx.fill();

        // Sparkle cross on the dangerous ones.
        if ((s.severity === "critical" || s.severity === "high" || s.kind === "target") && s.kind !== "waypoint") {
          const len = r * 2.6 * twinkle;
          ctx.strokeStyle = hexToRgba("#ffffff", 0.5 * alpha);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(s.x - len, s.y);
          ctx.lineTo(s.x + len, s.y);
          ctx.moveTo(s.x, s.y - len);
          ctx.lineTo(s.x, s.y + len);
          ctx.stroke();
        }

        // Pulsing ring around the target while scanning.
        if (s.kind === "target" && isRunning && !reduce) {
          const k = (t * 0.6) % 1;
          ctx.strokeStyle = `rgba(226,232,240,${(1 - k) * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 14 + k * 70, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label.
        {
          const text = s.label.length > 30 && !isHover ? `${s.label.slice(0, 29)}…` : s.label;
          ctx.font = `${isHover ? "600 12px" : s.kind === "target" ? "600 12px" : "11px"} ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.textAlign = "center";
          ctx.fillStyle = isHover
            ? "rgba(255,255,255,0.95)"
            : s.kind === "target"
              ? "rgba(226,232,240,0.85)"
              : s.kind === "waypoint"
                ? `rgba(148,163,184,${(dim ? 0.2 : 0.45) * ease})`
                : `rgba(203,213,225,${(dim ? 0.25 : 0.62) * ease})`;
          ctx.fillText(text, s.x, s.y + r + 16);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduce, isRunning]);

  // ── Pointer interaction ────────────────────────────────────────────────────

  const starAt = (x: number, y: number) => {
    let best: Star | null = null;
    let bestD = Infinity;
    for (const s of starsRef.current) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.r + 10 && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };

  const localPoint = (e: ReactPointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPoint(e);
    const drag = dragRef.current;
    if (drag) {
      const s = starsRef.current.find((st) => st.id === drag.id);
      if (s && s.kind !== "target") {
        s.x = x;
        s.y = y;
        s.pinned = true;
        drag.moved = true;
      }
      return;
    }
    const s = starAt(x, y);
    const id = s?.id ?? null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHover(s ? { star: s, x, y, w: sizeRef.current.w, h: sizeRef.current.h } : null);
    } else if (s && hover && (Math.abs(hover.x - x) > 2 || Math.abs(hover.y - y) > 2)) {
      setHover({ star: s, x, y, w: sizeRef.current.w, h: sizeRef.current.h });
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPoint(e);
    const s = starAt(x, y);
    if (!s) return;
    dragRef.current = { id: s.id, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const s = starsRef.current.find((st) => st.id === drag.id);
    if (s) s.pinned = false;
    if (!drag.moved && s?.finding && onSelect) onSelect(s.finding);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
    setHover(null);
  };

  const hoveredFinding = hover?.star.finding;
  const statusText = isRunning
    ? findingCount === 0
      ? "Mapping the sky. Stars appear as findings are discovered."
      : `Crafting the constellation. ${findingCount} ${findingCount === 1 ? "star" : "stars"}, ${pathCount} attack ${pathCount === 1 ? "path" : "paths"}.`
    : findingCount === 0
      ? "Clear skies. No findings on this target."
      : `${findingCount} ${findingCount === 1 ? "star" : "stars"}, ${pathCount} attack ${pathCount === 1 ? "path" : "paths"}.`;

  return (
    <div
      ref={wrapRef}
      className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#030712] ${className ?? "h-[520px]"}`}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: hover ? (hover.star.finding ? "pointer" : "grab") : "default" }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      {/* Status chip */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] font-mono text-slate-200 backdrop-blur">
        <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? "animate-pulse bg-cyan-300" : "bg-emerald-300"}`} />
        {statusText}
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute right-4 top-4 hidden items-center gap-3 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-300 backdrop-blur sm:flex">
        {(["critical", "high", "medium", "low", "info"] as Severity[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: SEVERITY_COLOR[s], boxShadow: `0 0 8px ${SEVERITY_COLOR[s]}` }}
            />
            {s}
          </span>
        ))}
      </div>

      {/* Hint */}
      <div className="pointer-events-none absolute bottom-3 left-4 text-[10px] font-mono text-slate-400/80">
        {graph.chainSource === "inferred"
          ? "Attack paths inferred from findings. Drag a star to move it. Click a star to see the fix."
          : "Bright lines are the attack chain. Drag a star to move it. Click a star to see the fix."}
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-white/10 bg-black/75 p-3 text-xs text-slate-100 shadow-xl backdrop-blur"
          style={{
            left: Math.min(hover.x + 16, Math.max(0, hover.w - 276)),
            top: Math.min(hover.y + 16, Math.max(0, hover.h - 120)),
          }}
        >
          {hoveredFinding ? (
            <>
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: SEVERITY_COLOR[hoveredFinding.severity] }}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-300">
                  {hoveredFinding.severity} · {hoveredFinding.tool}
                </span>
              </div>
              <p className="mt-1 font-semibold leading-snug">{hoveredFinding.title}</p>
              {hoveredFinding.component && (
                <p className="mt-1 truncate font-mono text-[10px] text-slate-400">{hoveredFinding.component}</p>
              )}
              <p className="mt-2 text-[10px] text-cyan-200/90">Click to see the fix</p>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-300">
                {hover.star.kind === "target" ? "Target" : "Chain step"}
              </p>
              <p className="mt-1 font-semibold leading-snug">{hover.star.label}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
