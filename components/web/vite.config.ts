import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Single source of truth (repo root); baked into the bundle at build time so the
// rail can show it offline. Bump with scripts/bump-build.sh before each deploy.
// Degrade gracefully if it isn't in the build context (never fail the build on it).
let ver: { version: string; build: string } = { version: "0.0.0", build: "0000000" };
try {
  ver = JSON.parse(readFileSync(fileURLToPath(new URL("../../version.json", import.meta.url)), "utf8"));
} catch {
  console.warn("[vite] version.json not found — using placeholder build stamp");
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(ver.version),
    __APP_BUILD__: JSON.stringify(ver.build),
  },
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: proxy API calls to the local @cast/api server. In production nginx
    // does this (SOC-style).
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
