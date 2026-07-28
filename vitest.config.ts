import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    css: false,
    // Preserve Vitest's recursive defaults and ignore local nested worktrees.
    // Without this, a worktree under .claude/ is discovered as a second copy
    // of the project, including dependency test files from its node_modules.
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  css: {
    postcss: "",
  },
});
