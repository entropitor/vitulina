import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { root } from "./commands/root.js";
import { PrismaLive } from "./Prisma.js";

const cli = Command.run(root, {
  name: "vitulina",
  version: "0.0.1",
});

cli(process.argv).pipe(
  Effect.provide(BunContext.layer),
  Effect.provide(PrismaLive),
  BunRuntime.runMain,
);
