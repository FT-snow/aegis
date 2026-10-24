import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        // The Aegis Worker. Override with AEGIS_API_ORIGIN when it runs elsewhere.
        target: process.env.AEGIS_API_ORIGIN ?? "http://localhost:8787",
        changeOrigin: false,
      },
    },
  },
});
