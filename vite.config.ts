import { defineConfig } from "vite";

// Relative base so the build works under the GitHub Pages subpath
// (https://baditaflorin.github.io/flowfield/) without hardcoding the repo name.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION ?? "dev"),
    __GIT_COMMIT__: JSON.stringify(process.env.VITE_GIT_COMMIT ?? "local"),
  },
  build: {
    outDir: "docs",
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022",
  },
  server: { host: "127.0.0.1", port: 5173 },
});
