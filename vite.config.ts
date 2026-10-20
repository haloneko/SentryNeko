import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the frontend from this fixed port during development.
const devHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  css: {
    // Module classes are written in kebab case and read as camel case, e.g. `.todo-row` is
    // `styles.todoRow` in a component.
    modules: { localsConvention: "camelCase" },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: devHost ?? false,
    hmr: devHost ? { protocol: "ws", host: devHost, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome105",
    sourcemap: false,
  },
});
