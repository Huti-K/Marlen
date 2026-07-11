import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs in each worker before any test module is imported, so the
    // isolation env vars (scratch DATABASE_PATH, silent logs, neutralized
    // credentials) are in place before src/env.ts reads process.env.
    setupFiles: ["./test/setup.ts"],
  },
});
