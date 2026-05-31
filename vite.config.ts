import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Vite config for the Tauri frontend. `@` -> ./src.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Tauri expects a fixed dev server.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust crate from Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Build for the WebKit/WebView2 engines Tauri ships.
  build: {
    target: ["es2022", "chrome110", "safari15"],
    sourcemap: false,
  },
});
