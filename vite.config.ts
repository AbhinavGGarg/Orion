import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    outDir: "dist/assets",
    lib: {
      entry: { particles: "background.tsx", constellation: "constellation.tsx" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "particles",
    },
    minify: true,
  },
});
