#!/usr/bin/env bun
// Entry point launcher: the real CLI (and its bun-only imports like
// bun:sqlite) must not be loaded statically, or Node would crash on module
// resolution before this check can print a useful error.
if (typeof Bun === "undefined") {
  console.error(
    "vitulina requires the Bun runtime (https://bun.sh) — it cannot run under Node.js.",
  );
  process.exit(1);
}

await import("./cli.js");
