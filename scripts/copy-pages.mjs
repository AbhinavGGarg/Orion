import { copyFile, mkdir, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const pages = [
  'index.html', 'signin.html', 'app.html', 'scanner.html',
  'auth.css', 'config.js', 'fixes.js', 'github.js',
  'constellation.css', 'constellation.js', 'blackhole.js', 'blackhole-shaders.js',
  'sky.css', 'POLARIS-LICENSE.txt',
];

// Only browser assets belong in the deployment output.
await mkdir(output, { recursive: true });
const entries = await readdir(output);
if (entries.some(name => name !== 'assets' && !pages.includes(name))) {
  throw new Error('Unexpected file in dist. Inspect the output before deploying.');
}
for (const page of pages) await copyFile(new URL(page, root), new URL(page, output));
console.log(`Copied ${pages.length} public files to dist.`);
