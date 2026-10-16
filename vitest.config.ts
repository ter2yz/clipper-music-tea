import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every test drives the real CLI (ffmpeg + Chromium), so they are slow by nature.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Renders are CPU-heavy; running test files one at a time keeps timings predictable.
    fileParallelism: false,
  },
});
