import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/admin-v2/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "../public/admin-v2",
    emptyOutDir: true
  }
});
