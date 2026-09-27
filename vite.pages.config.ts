import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/postcss";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./pages-src", import.meta.url)),
  base: "/smwl-assets-web/",
  publicDir: false,
  plugins: [react()],
  css: { postcss: { plugins: [tailwind()] } },
  build: { outDir: "../dist-pages", emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./pages-src/index.html', import.meta.url)),
      simulator: fileURLToPath(new URL('./pages-src/simulator/index.html', import.meta.url)),
    } },
  },
});
