# Polaris

Polaris constellation preview with a Supabase database and scan function.

Deploy the frontend to Vercel and open `/` to start on the landing page.
Backend setup is in `SETUP.md`. The production app does not need a local server.

The landing page includes a Polaris-based 3D demo with sample findings. Saved
reports have a 3D constellation tab with clickable evidence and a fix simulation.
Simulations do not edit files or resolve findings. Re-scan after applying fixes.
Report chat uses Groq through an authenticated Supabase function.

Use Node 22.12 or newer in the Node 22 release line. From this folder:

```sh
npm ci
npm run build
vercel deploy
```

Open the Vercel preview URL on the landing page. `FRONTEND.md` describes
the React, TypeScript, Tailwind and shadcn setup. The Echoes particle effect is
a transparent layer on sign-in, dashboard and scanner pages only. Build output is in dist.

`config.js` holds this copy's connection settings and is ignored by Git.
`config.example.js` contains the placeholders to use when sharing the source.
Never put a secret or service-role key in browser code.

Run the scan regression checks with Node 22.17 or newer:

```sh
node tests/scan-regression.cjs
node --experimental-strip-types tests/chat.cjs
```

These exercise the actual scan handler with simulated network and database
failures. They also check report status and retry links. They do not contact
target websites or require credentials.
