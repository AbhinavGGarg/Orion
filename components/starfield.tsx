"use client";

import { useEffect, useRef } from "react";

// The real Orion constellation, normalised to a unit box. Shoulders at the
// top (Betelgeuse, Bellatrix), the belt in the middle, feet at the bottom
// (Saiph, Rigel). Drawn faintly behind the hero as a nod to the name.
const ORION_STARS: { x: number; y: number; r: number }[] = [
  { x: 0.64, y: 0.1, r: 2.6 }, // Betelgeuse
  { x: 0.36, y: 0.14, r: 2.1 }, // Bellatrix
  { x: 0.56, y: 0.5, r: 1.9 }, // Alnitak
  { x: 0.5, y: 0.52, r: 1.9 }, // Alnilam
  { x: 0.44, y: 0.54, r: 1.9 }, // Mintaka
  { x: 0.62, y: 0.9, r: 2.0 }, // Saiph
  { x: 0.34, y: 0.92, r: 2.7 }, // Rigel
];
const ORION_LINES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 4],
  [2, 3],
  [3, 4],
  [2, 5],
  [4, 6],
  [5, 6],
];

interface Props {
  className?: string;
  density?: number;
  constellation?: boolean;
  reduce?: boolean;
}

export function Starfield({ className, density = 2200, constellation = true, reduce = false }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parent = canvas.parentElement ?? canvas;

    let stars: { x: number; y: number; r: number; p: number; drift: number }[] = [];
    let w = 0;
    let h = 0;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor((w * h) / density);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 + 0.25,
        p: Math.random() * Math.PI * 2,
        drift: 0.2 + Math.random() * 0.6,
      }));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    let raf = 0;
    const draw = (now: number) => {
      const t = reduce ? 0 : now / 1000;
      ctx.clearRect(0, 0, w, h);

      for (const s of stars) {
        const tw = reduce ? 0.7 : 0.5 + 0.5 * Math.sin(t * s.drift * 2 + s.p);
        ctx.fillStyle = `rgba(226,232,240,${0.15 + tw * 0.5})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (constellation) {
        // Keep the figure's aspect ratio and park it on the right side.
        const size = Math.min(h * 0.72, w * 0.26);
        const ox = w * 0.86 - size * 0.5;
        const oy = h * 0.5 - size * 0.5;
        const pt = (i: number) => ({ x: ox + ORION_STARS[i].x * size, y: oy + ORION_STARS[i].y * size });

        ctx.strokeStyle = "rgba(165,180,252,0.22)";
        ctx.lineWidth = 1;
        for (const [a, b] of ORION_LINES) {
          const pa = pt(a);
          const pb = pt(b);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }
        ORION_STARS.forEach((s, i) => {
          const p = pt(i);
          const tw = reduce ? 1 : 0.8 + 0.2 * Math.sin(t * 1.7 + i);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s.r * 6 * tw);
          g.addColorStop(0, "rgba(199,210,254,0.7)");
          g.addColorStop(0.4, "rgba(129,140,248,0.22)");
          g.addColorStop(1, "rgba(129,140,248,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s.r * 6 * tw, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, s.r * 0.9, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [density, constellation, reduce]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 ${className ?? ""}`} />;
}
