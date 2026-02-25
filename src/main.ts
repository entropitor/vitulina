import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { root } from "./commands/root.js";

const cli = Command.run(root, {
  name: "vitulina",
  version: "0.0.1",
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
