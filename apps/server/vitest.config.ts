import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // An empty test/ directory is a valid state and must not fail `pnpm check`.
    passWithNoTests: true,
  },
});
