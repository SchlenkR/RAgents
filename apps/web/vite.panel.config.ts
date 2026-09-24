import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** Die Panelseite der VS-Code-Erweiterung: ein Einstieg ohne Server und ohne Plugins, mit festen Dateinamen für das Webview. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../vscode/dist/webview", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("panel.html", import.meta.url)),
      output: { entryFileNames: "panel.js", chunkFileNames: "[name].js", assetFileNames: "panel.[ext]" },
    },
  },
});
