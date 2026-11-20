import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@ai-vis/types": path.resolve(__dirname, "../packages/types/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — changes rarely, caches well
          "vendor-react": ["react", "react-dom"],
          // ECharts is the largest dependency (~900 kB pre-minification)
          "vendor-echarts": ["echarts", "echarts-for-react"],
          // UI utilities
          "vendor-ui": ["lucide-react", "clsx"],
          // State management & immutability
          "vendor-state": ["zustand", "immer"],
          // Schema validation
          "vendor-zod": ["zod"],
        },
      },
    },
    // Raise the warning threshold slightly — we still split, but avoid
    // noisy warnings for the echarts chunk itself (~491 kB gzipped).
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        // When the backend isn't running yet (very first `npm run dev` before
        // it finishes compiling, or it crashed), Vite's default proxy error
        // page responds with a 500 whose body is a PLAIN-TEXT error message,
        // not JSON. Every frontend API caller (uploadDataset, fetchDataset,
        // etc.) does `JSON.parse`/`res.json()` on the response, so that plain
        // text throws a SyntaxError there instead of surfacing what actually
        // went wrong — which is exactly what produced the confusing "Failed
        // to parse server response: HTTP 500" message. Answering with a real
        // JSON envelope here (matching the backend's own ApiErrorResponse
        // shape) means every existing frontend error-handling path — which
        // already expects that shape from the real backend — reports the
        // true, actionable cause instead.
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if (!("writeHead" in res) || res.headersSent) return;
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "BACKEND_UNREACHABLE",
                  message:
                    "Cannot reach the backend server at http://localhost:4000. " +
                    "Make sure it's running (`npm run dev:backend`, or `npm run dev` " +
                    "to start both) and try again." +
                    (err?.message ? ` (${err.message})` : ""),
                },
              })
            );
          });
        },
      },
    },
  },
});
