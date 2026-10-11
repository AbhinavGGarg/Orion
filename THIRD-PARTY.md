# Polaris constellation

The 3D constellation adapts the star rendering, radial textures, background
star distribution, orbit settings and force simulation from
[Polaris](https://github.com/AbhinavGGarg/Polaris), specifically
`components/attack-sky.tsx` at commit
`9807f1b993738084cb694e5bd85ecf7000121054`.

Copyright (c) 2026 Siddharth Shringarpure. Distributed under the MIT license;
the complete notice is included in POLARIS-LICENSE.txt and deployed publicly.

The implementation uses Three.js directly inside Polaris's React island.
It uses Polaris's saved findings and does not infer attack chains. The landing
illustration uses clearly labeled sample findings.
Polaris's motion control, responsive layout, keyboard-accessible star labels,
resource cleanup and a textual WebGL fallback are added by this integration.
