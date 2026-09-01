import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = "http://127.0.0.1:8788";

export default defineConfig({
  plugins: [react()],
  base: "/admin-v2/",
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", proxyReq => {
            proxyReq.setHeader("Origin", apiTarget);
            proxyReq.setHeader("Referer", `${apiTarget}/admin-v2/`);
          });
        }
      }
    }
  },
  build: {
    outDir: "../public/admin-v2",
    emptyOutDir: true
  }
});
