"use client";

import { useEffect, useRef } from "react";

interface TrailPoint {
  x: number;
  y: number;
  bornAt: number;
  intensity: number;
}

const TRAIL_LIFETIME_MS = 1200;
const MAX_TRAIL_POINTS = 140;

export function AmbientCursorTrails() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;
    const lowPower =
      (navigator.hardwareConcurrency ?? 8) <= 4
      || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4
      || window.matchMedia("(hover: none)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    let pointerActive = false;
    let targetX = 0;
    let targetY = 0;
    let smoothX = 0;
    let smoothY = 0;
    let lastEmitX = 0;
    let lastEmitY = 0;
    let rafId = 0;
    let frameToggle = false;
    let lastFrameTime = performance.now();
    let frameTimeAvg = 16;
    let adaptiveLowQuality = lowPower;

    let points: TrailPoint[] = [];
    const maxTrailPoints = lowPower ? Math.min(96, MAX_TRAIL_POINTS) : MAX_TRAIL_POINTS;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (targetX === 0 && targetY === 0) {
        targetX = width * 0.5;
        targetY = height * 0.5;
        smoothX = targetX;
        smoothY = targetY;
        lastEmitX = targetX;
        lastEmitY = targetY;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointerActive = true;
      targetX = event.clientX;
      targetY = event.clientY;
    };

    const deactivatePointer = () => {
      pointerActive = false;
    };

    const draw = (now: number) => {
      const frameDelta = now - lastFrameTime;
      lastFrameTime = now;
      frameTimeAvg = frameTimeAvg * 0.9 + frameDelta * 0.1;
      if (!lowPower) {
        if (frameTimeAvg > 20) adaptiveLowQuality = true;
        if (frameTimeAvg < 16.2) adaptiveLowQuality = false;
      }

      if (adaptiveLowQuality) {
        frameToggle = !frameToggle;
        if (frameToggle) {
          rafId = window.requestAnimationFrame(draw);
          return;
        }
      }
      ctx.clearRect(0, 0, width, height);

      smoothX += (targetX - smoothX) * 0.24;
      smoothY += (targetY - smoothY) * 0.24;

      const stepDistance = Math.hypot(smoothX - lastEmitX, smoothY - lastEmitY);
      if (pointerActive && stepDistance > (adaptiveLowQuality ? 2.9 : 1.8)) {
        points.push({
          x: smoothX,
          y: smoothY,
          bornAt: now,
          intensity: Math.min(1, stepDistance / 16),
        });
        lastEmitX = smoothX;
        lastEmitY = smoothY;
      }

      points = points.filter((point) => now - point.bornAt <= TRAIL_LIFETIME_MS);
      if (points.length > maxTrailPoints) {
        points = points.slice(points.length - maxTrailPoints);
      }

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (let i = 1; i < points.length; i += 1) {
        const previous = points[i - 1];
        const current = points[i];
        const age = Math.min(1, (now - current.bornAt) / TRAIL_LIFETIME_MS);
        const alpha = Math.pow(1 - age, 1.7);
        if (alpha <= 0.01) continue;

        const gradient = ctx.createLinearGradient(previous.x, previous.y, current.x, current.y);
        gradient.addColorStop(0, `rgba(79, 121, 255, ${0.3 * alpha})`);
        gradient.addColorStop(0.55, `rgba(82, 201, 255, ${0.36 * alpha})`);
        gradient.addColorStop(1, `rgba(130, 125, 255, ${0.22 * alpha})`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = (adaptiveLowQuality ? 6 : 9) + current.intensity * (adaptiveLowQuality ? 2.4 : 4.2);
        if (!adaptiveLowQuality) {
          ctx.shadowBlur = 18;
          ctx.shadowColor = `rgba(86, 196, 255, ${0.3 * alpha})`;
        } else {
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
        }

        const midX = (previous.x + current.x) * 0.5;
        const midY = (previous.y + current.y) * 0.5;
        ctx.beginPath();
        ctx.moveTo(previous.x, previous.y);
        ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
        ctx.stroke();
      }

      if (pointerActive && !adaptiveLowQuality) {
        const glow = ctx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, 82);
        glow.addColorStop(0, "rgba(122, 220, 255, 0.24)");
        glow.addColorStop(0.45, "rgba(96, 167, 255, 0.12)");
        glow.addColorStop(1, "rgba(60, 112, 255, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, 82, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    rafId = window.requestAnimationFrame(draw);

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerdown", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerMove);
      window.removeEventListener("pointerleave", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[2] opacity-90 mix-blend-screen"
    />
  );
}
