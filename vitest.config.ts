import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `koordynator/` is a gitignored nested clone of this repository. Without this exclude
    // vitest collects its stale copy of every suite, so each failure is reported twice and
    // results reflect outdated code rather than the working tree.
    exclude: ["**/node_modules/**", "**/dist/**", "koordynator/**"]
  }
});
