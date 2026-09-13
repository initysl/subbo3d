import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // The deterministic core runs in plain node. That is not just faster than
    // jsdom: it makes any accidental DOM dependency inside lib/sim a hard
    // failure rather than something that quietly works in the browser.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
