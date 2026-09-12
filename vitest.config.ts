import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    allowOnly: false,
    coverage: {
      include: ["shared/**/*.ts", "server/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: {
        "shared/**/*.ts": {
          branches: 80,
          functions: 100,
          lines: 90,
          statements: 90,
        },
      },
    },
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
