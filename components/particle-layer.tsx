"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  depth: number;
}

const MAX_PARTICLES = 96;
const CONNECTION_DISTANCE = 120;

export function ParticleLayer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;
    const lowPower =
      (navigator.hardwareConcurrency ?? 8) <= 4
      || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
      || window.matchMedia("(hover: none)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let frameToggle = false;

    let pointerX = 0;
    let pointerY = 0;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerActive = false;
    let pointerBoost = 0;
    let pointerBoostTarget = 0;

    let particles: Particle[] = [];

    const initParticles = () => {
      const area = width * height;
      const minCount = lowPower ? 30 : 46;
      const maxCount = lowPower ? 56 : Math.min(MAX_PARTICLES, 84);
      const count = Math.min(maxCount, Math.max(minCount, Math.floor(area / (lowPower ? 30000 : 26000))));
      particles = Array.from({ length: count }).map(() => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        radius: 1.1 + Math.random() * 2.2,
        alpha: 0.22 + Math.random() * 0.26,
        depth: 0.5 + Math.random() * 0.8,
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
      pointerX = width * 0.5;
      pointerY = height * 0.5;
      pointerTargetX = pointerX;
      pointerTargetY = pointerY;
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerActive = true;
      pointerTargetX = event.clientX;
      pointerTargetY = event.clientY;
      const target = event.target as HTMLElement | null;
      const interactiveParent = target?.closest(
        ".surface-panel, .surface-panel-muted, button, a, input, textarea",
      );
      pointerBoostTarget = interactiveParent ? 1 : 0;
    };

    const onPointerLeave = () => {
      pointerActive = false;
      pointerBoostTarget = 0;
    };

    const drawFrame = () => {
      if (lowPower) {
        frameToggle = !frameToggle;
        if (frameToggle) {
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }
      }

      ctx.clearRect(0, 0, width, height);

      pointerX += (pointerTargetX - pointerX) * 0.12;
      pointerY += (pointerTargetY - pointerY) * 0.12;
      pointerBoost += (pointerBoostTarget - pointerBoost) * 0.08;

      const parallaxX = ((pointerX - width * 0.5) / width) * 18;
      const parallaxY = ((pointerY - height * 0.5) / height) * 18;

      for (const point of particles) {
        point.x += point.vx;
        point.y += point.vy;

        const attraction = pointerActive ? 0.00095 + pointerBoost * 0.0013 : 0;
        if (attraction > 0) {
          const dx = pointerX - point.x;
          const dy = pointerY - point.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 220) {
            point.vx += (dx / dist) * attraction;
            point.vy += (dy / dist) * attraction;
          }
        }

        point.vx *= 0.987;
        point.vy *= 0.987;
        point.vx = Math.max(-0.42, Math.min(0.42, point.vx));
        point.vy = Math.max(-0.42, Math.min(0.42, point.vy));

        if (point.x < -8) point.x = width + 8;
        if (point.x > width + 8) point.x = -8;
        if (point.y < -8) point.y = height + 8;
        if (point.y > height + 8) point.y = -8;
      }

      ctx.save();
      ctx.globalCompositeOperation = "screen";

      if (!lowPower) {
        for (let i = 0; i < particles.length; i += 1) {
          const a = particles[i];
          const ax = a.x + parallaxX * a.depth;
          const ay = a.y + parallaxY * a.depth;

          for (let j = i + 1; j < particles.length; j += 1) {
            const b = particles[j];
            const bx = b.x + parallaxX * b.depth;
            const by = b.y + parallaxY * b.depth;
            const dx = ax - bx;
            const dy = ay - by;
            const dist = Math.hypot(dx, dy);
            if (dist > CONNECTION_DISTANCE) continue;
            const alpha = (1 - dist / CONNECTION_DISTANCE) * (0.1 + pointerBoost * 0.08);
            ctx.strokeStyle = `rgba(110, 193, 255, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
          }
        }
      }

      for (const point of particles) {
        const x = point.x + parallaxX * point.depth;
        const y = point.y + parallaxY * point.depth;
        const localAlpha = point.alpha * (0.95 + pointerBoost * 0.35);
        if (lowPower) {
          ctx.fillStyle = `rgba(123, 198, 255, ${localAlpha * 0.72})`;
        } else {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, point.radius * 5.2);
          glow.addColorStop(0, `rgba(137, 214, 255, ${localAlpha})`);
          glow.addColorStop(0.55, `rgba(82, 146, 255, ${localAlpha * 0.52})`);
          glow.addColorStop(1, "rgba(82, 146, 255, 0)");
          ctx.fillStyle = glow;
        }
        ctx.beginPath();
        ctx.arc(x, y, point.radius * (lowPower ? 2.2 : 5.2), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(drawFrame);
    };

    resize();
    rafId = window.requestAnimationFrame(drawFrame);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1] opacity-[0.82]"
    />
  );
}
