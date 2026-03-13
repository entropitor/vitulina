import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { root } from "./commands/root.js";
import { PrismaLive } from "./Prisma.js";
import { GlobalConfigurationLive } from "./Config.service.js";

const cli = Command.run(root, {
  name: "vitulina",
  version: "0.0.1",
});

cli(process.argv).pipe(
  Effect.provide(GlobalConfigurationLive),
  Effect.provide(PrismaLive),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
