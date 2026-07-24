import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const ownerToken = env.VITE_OWNER_TOKEN ?? "";

  return {
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (ownerToken) {
                proxyReq.setHeader("Authorization", `Bearer ${ownerToken}`);
              }
            });
          },
        },
        "/ws": {
          target: "ws://localhost:8787",
          ws: true,
          configure: (proxy) => {
            proxy.on("proxyReqWs", (proxyReq) => {
              if (ownerToken) {
                const oldPath = proxyReq.path;
                const sep = oldPath.includes("?") ? "&" : "?";
                proxyReq.path = `${oldPath}${sep}token=${encodeURIComponent(ownerToken)}`;
              }
            });
          },
        },
      },
    },
  };
});
