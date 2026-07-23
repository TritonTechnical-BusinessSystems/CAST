import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
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
