# Polaris constellations

This is a separate preview of the existing Polaris application. Its Supabase
connection and scan flow stay intact. Production remains a separate deployment.

The landing page uses the supplied BlackHoleHeroSection shader equations.
Those equations are retained to preserve the reference's lensing and disc
appearance; the browser renderer is adapted to the existing static site.
The sign-in, dashboard and scanner pages mount Echoes's particles as a React
component. TypeScript and Tailwind 4 build it without migrating the existing
application. The landing page keeps its original constellation animation.

Palette: space #080b11, surface #111620, starlight #f3e8d9, dust #a6adba,
warm accent #e8b982, constellation #93aec9. General Sans carries headings;
Switzer carries interface copy. Monospace is reserved for URLs and scan data.

The hero places clear, left-aligned copy beside a luminous black hole. Stars
drift above the scene and join into faint constellations. The rest of the page
connects that idea to the product: a website, public assets and evidence form
a picture of what needs attention. Keep navigation and scan controls literal.
Use normal vertical scrolling, not the design search's suggested horizontal
journey. Avoid bright green accents and unrelated decorative cards.

Motion is decorative and never blocks a control. Pause it when the page is
hidden, start it paused under reduced motion, and provide a visible pause
button. An explicit Resume choice overrides that default across page loads
and new tabs. Changes to the motion control synchronize across open tabs.
The Echoes particle canvas is transparent at z-index 1, above the background
at 0 and below navigation and content at 2. It retains Echoes's motion and
cursor repulsion, with soft purple and cool white dots and purple connections. The landing page retains its
existing constellation field. All pages use the same motion control.
On small screens, put the scene above the copy and lower rendering resolution.
Keep a static fallback when WebGL is unavailable.

Done checks: the old site remains available; the preview opens on the landing
page; sign-in and scanner keep their behavior; particles appear on every page;
the hero uses the supplied shader; mobile has no horizontal overflow; motion
can be paused; the preview and share archive contain no private credentials.
