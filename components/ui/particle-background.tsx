import { useEffect, useRef } from "react";
import "../../index.css";

const COLORS = ["#a78bfa", "#c4b5fd", "#ddd6fe", "#8b7bb5", "#f2f0ff", "#8e91a8"];
const PARTICLE_COUNT = 120;
const BASE_SPEED = 1.4;
const CONNECTION_DISTANCE = 130;

interface Particle {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  color: string;
}

interface ParticleBackgroundProps {
  className?: string;
  paused?: boolean;
}

export default function ParticleBackground({ className = "", paused }: ParticleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const playbackRef = useRef<(() => void) | null>(null);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles: Particle[] = [];
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let dpr = 1;
    let pointerX = -1000;
    let pointerY = -1000;
    let frame = 0;
    let last = 0;
    let disposed = false;

    function draw(step = 0) {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (step) {
        // Fade the previous frame without painting over Polaris's background.
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(0.82, step)})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      for (const particle of particles) {
        if (step) {
          const dx = particle.x - pointerX;
          const dy = particle.y - pointerY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 120) {
            const force = ((120 - distance) / 12) * 0.18 * step;
            particle.vx += (dx / distance) * force;
            particle.vy += (dy / distance) * force;
          }
          const maxSpeed = BASE_SPEED * 2.5;
          const retention = Math.pow(0.97, step);
          particle.vx = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vx)) * retention + particle.baseVx * (1 - retention);
          particle.vy = Math.max(-maxSpeed, Math.min(maxSpeed, particle.vy)) * retention + particle.baseVy * (1 - retention);
          particle.x += particle.vx * step;
          particle.y += particle.vy * step;
          if (particle.x < 0) particle.x = width;
          if (particle.x > width) particle.x = 0;
          if (particle.y < 0) particle.y = height;
          if (particle.y > height) particle.y = 0;
        }
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.fill();
      }

      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        const limit = Math.min(particles.length, i + 14);
        for (let j = i + 1; j < limit; j++) {
          const first = particles[i];
          const next = particles[j];
          const distance = Math.hypot(first.x - next.x, first.y - next.y);
          if (distance >= CONNECTION_DISTANCE) continue;
          const opacity = (1 - distance / CONNECTION_DISTANCE) * 0.17;
          ctx.strokeStyle = `rgba(167,139,250,${opacity})`;
          ctx.beginPath();
          ctx.moveTo(first.x, first.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }
      }
    }

    function resize() {
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      const nextDpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4.5e6 / (nextWidth * nextHeight)));
      if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;
      for (const particle of particles) {
        particle.x *= nextWidth / width;
        particle.y *= nextHeight / height;
      }
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (!particles.length) {
        pointerX = width / 2;
        pointerY = height / 2;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const vx = (Math.random() * 2 - 1) * BASE_SPEED;
          const vy = (Math.random() * 2 - 1) * BASE_SPEED;
          particles.push({
            x: Math.random() * width, y: Math.random() * height,
            size: Math.random() * 3 + 0.5,
            vx, vy, baseVx: vx, baseVy: vy,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
          });
        }
      }
      draw();
    }

    function animate(now: number) {
      if (disposed) return;
      const step = Math.min((now - last) / (1000 / 60), 3);
      last = now;
      if (step > 0) draw(step);
      frame = requestAnimationFrame(animate);
    }

    function syncPlayback() {
      cancelAnimationFrame(frame);
      frame = 0;
      // A controlled false value is the user's explicit Resume choice.
      if (disposed || document.hidden || (pausedRef.current ?? motion.matches)) return;
      last = performance.now();
      frame = requestAnimationFrame(animate);
    }

    function onPointerMove(event: PointerEvent) {
      pointerX = event.clientX;
      pointerY = event.clientY;
    }
    function onPointerLeave() {
      pointerX = pointerY = -1000;
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    playbackRef.current = syncPlayback;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", syncPlayback);
    motion.addEventListener("change", syncPlayback);
    syncPlayback();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      playbackRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      window.removeEventListener("blur", onPointerLeave);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", syncPlayback);
      motion.removeEventListener("change", syncPlayback);
    };
  }, []);

  useEffect(() => playbackRef.current?.(), [paused]);

  return <canvas ref={canvasRef} className={`echoes-particles ${className}`} aria-hidden="true" />;
}
