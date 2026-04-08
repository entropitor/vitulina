import { Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { Prisma } from "../Prisma.js";
import { ProjectConfigurationLive } from "../services/Config.js";
import { isProcessAlive } from "../util/process.js";
import {
  allOption,
  allServersOption,
  buildServerWhere,
  envOption,
  projectOption,
  serverFilter,
} from "./shared.js";

export const down = Command.make(
  "down",
  {
    project: projectOption,
    env: envOption,
    all: allOption,
    allServers: allServersOption,
    servers: serverFilter,
  },
  ({ project, env, all, allServers, servers }) =>
    Effect.gen(function* () {
      const prisma = yield* Prisma;

      const where = yield* buildServerWhere({ project, env, all, allServers, servers });

      const records = yield* Effect.promise(() => prisma.devServer.findMany({ where }));

      for (const record of records) {
        if (isProcessAlive(record.pid)) {
          process.kill(record.pid, "SIGTERM");
          yield* Console.log(`Stopped ${record.server_name} (pid ${record.pid})`);
        } else {
          yield* Console.log(`${record.server_name} (pid ${record.pid}) already dead, cleaning up`);
        }
      }

      if (records.length > 0) {
        yield* Effect.promise(() =>
          prisma.devServer.deleteMany({
            where: { id: { in: records.map((r) => r.id) } },
          }),
        );
      }
    }).pipe(Effect.provide(ProjectConfigurationLive)),
);
