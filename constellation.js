const canvas = document.createElement('canvas');
canvas.className = 'constellation-field';
canvas.setAttribute('aria-hidden', 'true');
const showConstellations = document.documentElement.dataset.background !== 'echoes';
if (showConstellations) document.body.prepend(canvas);
const ctx = showConstellations ? canvas.getContext('2d') : null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const button = document.createElement('button');
button.type = 'button';
button.className = 'motion-control';
document.body.append(button);

let preference = null;
try { preference = sessionStorage.getItem('polaris.motion'); } catch {}
try {
  preference = localStorage.getItem('polaris.motion') ?? preference;
  if (preference !== null) localStorage.setItem('polaris.motion', preference);
} catch {}
let paused = preference === 'off' || (preference !== 'on' && reduced.matches);
let stars = [], width = 0, height = 0, frame = 0, last = 0, elapsed = 0;
const pointer = { x: -1000, y: -1000 };

function paint() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const points = stars.map(star => ({
    ...star,
    px: ((star.x * width + elapsed * star.vx) % (width + 40) + width + 40) % (width + 40) - 20,
    py: ((star.y * height + elapsed * star.vy) % (height + 40) + height + 40) % (height + 40) - 20,
  }));
  for (let i = 0; i < points.length; i++) {
    const star = points[i];
    let links = 0;
    for (let j = i + 1; j < points.length && links < 3; j++) {
      const next = points[j];
      const distance = Math.hypot(next.px - star.px, next.py - star.py);
      if (distance > 125) continue;
      ctx.strokeStyle = 'rgba(165,191,216,' + (1 - distance / 125) * 0.23 + ')';
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(star.px, star.py); ctx.lineTo(next.px, next.py); ctx.stroke();
      links++;
    }
    const near = Math.max(0, 1 - Math.hypot(pointer.x - star.px, pointer.y - star.py) / 170);
    const alpha = star.alpha + Math.sin(elapsed * 0.6 + star.phase) * 0.12;
    ctx.fillStyle = 'rgba(239,232,221,' + Math.min(1, alpha + near * 0.3) + ')';
    ctx.beginPath(); ctx.arc(star.px, star.py, star.radius + near * 0.5, 0, Math.PI * 2); ctx.fill();
    if (star.radius > 1.25) {
      ctx.strokeStyle = 'rgba(235,215,185,' + alpha * 0.35 + ')';
      ctx.beginPath(); ctx.moveTo(star.px - 4, star.py); ctx.lineTo(star.px + 4, star.py);
      ctx.moveTo(star.px, star.py - 4); ctx.lineTo(star.px, star.py + 4); ctx.stroke();
    }
  }
}

function tick(now) {
  if (paused || document.hidden || !ctx) { frame = 0; last = 0; return; }
  frame = requestAnimationFrame(tick);
  if (now - last < 32) return;
  elapsed += last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  paint();
}

function syncMotion() {
  cancelAnimationFrame(frame); frame = 0; last = 0;
  document.documentElement.dataset.motion = paused ? 'off' : 'on';
  button.textContent = paused ? 'Resume motion' : 'Pause motion';
  button.setAttribute('aria-pressed', String(paused));
  paint();
  if (!paused && !document.hidden && ctx) frame = requestAnimationFrame(tick);
  document.dispatchEvent(new Event('polaris:motion'));
}

function resize() {
  if (!ctx) return;
  width = innerWidth; height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.min(110, Math.max(35, Math.round(width * height / 11500)));
  stars = Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(), radius: 0.45 + Math.random() * 1.05,
    alpha: 0.25 + Math.random() * 0.45, phase: Math.random() * Math.PI * 2,
    vx: 2 + Math.random() * 4, vy: -1 - Math.random() * 3,
  }));
  paint();
}

button.addEventListener('click', () => {
  paused = !paused;
  preference = paused ? 'off' : 'on';
  try { sessionStorage.setItem('polaris.motion', preference); } catch {}
  try { localStorage.setItem('polaris.motion', preference); } catch {}
  syncMotion();
});
window.addEventListener('storage', event => {
  if (event.key !== 'polaris.motion' || event.storageArea !== localStorage) return;
  preference = event.newValue;
  paused = preference === 'off' || (preference !== 'on' && reduced.matches);
  syncMotion();
});
reduced.addEventListener('change', () => {
  paused = preference === 'off' || reduced.matches;
  syncMotion();
});
document.addEventListener('visibilitychange', syncMotion);
window.addEventListener('resize', resize);
window.addEventListener('pointermove', event => { pointer.x = event.clientX; pointer.y = event.clientY; }, { passive: true });
window.addEventListener('pointerout', event => { if (!event.relatedTarget) pointer.x = pointer.y = -1000; });
window.addEventListener('pagehide', () => cancelAnimationFrame(frame));
resize();
syncMotion();
