import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { root } from "./commands/root.js";
import { PrismaLive } from "./Prisma.js";
import { GlobalConfigurationLive } from "./services/Config.js";
import { VERSION } from "./version.js";

const cli = Command.run(root, {
  name: "vitulina",
  version: VERSION,
});

cli(process.argv).pipe(
  Effect.provide(GlobalConfigurationLive),
  Effect.provide(PrismaLive),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
