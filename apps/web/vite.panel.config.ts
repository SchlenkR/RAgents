import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** The panel page of the VS Code extension: an entry point without a server and without plugins, with fixed file names for the webview. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../vscode/dist/webview", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("src/panel.tsx", import.meta.url)),
      output: { entryFileNames: "panel.js", chunkFileNames: "[name].js", assetFileNames: "panel.[ext]" },
    },
  },
});
