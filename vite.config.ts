import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "app",
  base: "/app/",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "../dist/app",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
