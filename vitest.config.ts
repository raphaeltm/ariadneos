import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    allowOnly: false,
    coverage: {
      include: ["shared/**/*.ts", "server/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Floors, not targets. They exist so the pipeline that turns Slack
      // messages into process claims cannot quietly lose its tests again: it was
      // shipped at 5% statements under a config that only measured shared/.
      thresholds: {
        "server/mining/**/*.ts": {
          branches: 70,
          functions: 90,
          lines: 85,
          statements: 85,
        },
        "server/pipeline/**/*.ts": {
          branches: 65,
          functions: 85,
          lines: 80,
          statements: 80,
        },
        "server/slack/**/*.ts": {
          branches: 70,
          functions: 80,
          lines: 85,
          statements: 85,
        },
        "server/tenant/**/*.ts": {
          branches: 60,
          functions: 70,
          lines: 70,
          statements: 70,
        },
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
