import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  // CJS: avoids ESM CJS-interop issues with commander's require("events").
  format: ["cjs"],
  target: "node20",
  platform: "node",
  clean: true,
  noExternal: ["commander", "chalk", "cli-table3"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
