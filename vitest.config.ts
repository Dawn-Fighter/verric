import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Discover tests anywhere in the workspace
    include: ["apps/**/*.{test,spec}.{ts,tsx}", "packages/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    environment: "node",
    globals: false,
    // node:sqlite was added to Node's standard library in v22+. vite-node's
    // bundler can't transform it, so run tests in real Node child processes
    // (the `forks` pool) where node: imports resolve natively.
    pool: "forks",
    server: {
      deps: {
        external: [/^node:/]
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["apps/**/src/**", "packages/**/src/**"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**"]
    }
  },
  resolve: {
    alias: {
      // Match the Next.js @/* alias for files under apps/web
      "@": path.resolve(__dirname, "apps/web/src")
    }
  }
});
