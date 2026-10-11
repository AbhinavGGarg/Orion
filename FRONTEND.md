# Frontend setup

Use Node 22.12 or newer. Install the locked dependencies and build:

```sh
npm ci
npm run build
```

Vercel runs these commands through vercel.json and serves only dist.
No local development server is required. Deploy a preview with `vercel deploy`.
Keep it separate from production until the new design is approved.

The existing HTML pages still own sign-in, navigation and scans. React mounts
the decorative background on signin.html, app.html and scanner.html, plus the
Polaris constellation on the landing and saved-report pages.
The landing page does not import the Echoes effect or its CSS.

## Component paths

- `components/ui/particle-background.tsx`: reusable Echoes particle component.
- `components/ui/polaris-constellation.tsx`: Three.js visualization and simulation.
- `constellation.tsx`: lazy loading and the saved-report event bridge.
- `lib/constellation-model.ts`: sample data and saved findings mapped to stars.
- `sky.css`: styles scoped to the interactive constellation.
- `components/ui/demo.tsx`: standalone default-export demo.
- `background.tsx`: shared pause state and the React mount.
- `index.css`: Tailwind 4 entry and transparent particle overlay styles.
- `components.json`: shadcn configuration and aliases.
- `lib/utils.ts`: class merging utility for future shadcn components.

The `@/` alias resolves to this project root in TypeScript and Vite.
The components/ui folder keeps reusable UI in one predictable location and
matches both shadcn's configured output and the supplied demo import.
This project is already configured; do not run shadcn init again. Additional
components can be installed with `npx shadcn@latest add <component>`.

The particle effect uses React hooks and browser canvas APIs. It needs no provider,
external state store, images or icons. It adapts Echoes's ParticleBackground:
soft purple and cool white dots, short trails, nearby connections and cursor repulsion. The
motion settings are retained, with purple connections and a cooler palette. Rendering
is time based and fades alpha rather than painting an opaque dark rectangle,
so it can sit above Polaris's existing background. Echoes itself is unchanged.

Tailwind's theme and utilities are imported separately, without Preflight,
so the existing pages keep their control styling. Sources are limited to
React files to avoid generating utilities for unrelated legacy class names.
The setup follows the [Tailwind Vite guide](https://tailwindcss.com/docs/installation/using-vite)
and [shadcn manual setup](https://ui.shadcn.com/docs/installation/manual).

## Rendering

The existing background uses z-index 0. The particles use z-index 1 and
pointer-events: none. Navigation and page content use z-index 2 or higher.
Dialogs remain above both. The overlay never paints an opaque background.

The effect uses Echoes's 120 particles and soft purple and cool white palette, with a bounded
canvas resolution on larger and high-density displays. The old constellation
field runs only on the landing page, avoiding a second overlapping effect.
Pause motion stops the particles and persists across these pages and new tabs.
The choice is stored in localStorage and synchronizes open tabs; the previous
sessionStorage preference is retained as a fallback when storage is restricted.
Reduced motion starts with a static field. Explicitly choosing Resume motion
starts the animation and persists across page navigation. A new operating
system request for reduced motion pauses it again. Turning reduced motion
off preserves an explicit Pause choice. Hidden tabs stop the frame loop.
The standalone component follows reduced motion when paused is omitted;
passing paused=false explicitly enables animation.
An already open tab keeps its old HTML until reloaded. Reload after a preview
deployment; if motion was paused, use Resume motion to animate the field.

## Checks

The 3D constellation includes Scout, Analyst and Fixer as simulation agents.
They take turns highlighting the current finding during a fix preview. This
does not run agents, edit files or change saved findings. Fullscreen keeps the
orbit, zoom and motion controls available; selecting evidence exits fullscreen.

```sh
npm run typecheck
npm run build
npm test
```

The build copies an explicit public-file list into dist. Backend source,
private environment files, setup notes and Vercel account metadata are never
part of that output. In a shared copy, fill config.js from your own Supabase
project before deploying. The shared file contains placeholders only.
