import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ProjectConfiguration, ProjectConfigurationLive } from "../services/Config.js";
import { Prisma } from "../Prisma.js";
import { getJjWorkspaceName } from "../util/jj.js";
import { isProcessAlive } from "../util/process.js";

const envOption = Options.text("env").pipe(
  Options.withDefault((await getJjWorkspaceName()) ?? "default"),
);

const allOption = Options.boolean("all").pipe(Options.withAlias("a"), Options.withDefault(false));

const serverFilter = Args.repeated(Args.text({ name: "server" }));

export const down = Command.make(
  "down",
  { env: envOption, all: allOption, servers: serverFilter },
  ({ env, all, servers: filterServers }) =>
    Effect.gen(function* () {
      const prisma = yield* Prisma;

      let serverNames: Array<string>;
      if (all) {
        const allRecords = yield* Effect.promise(() =>
          prisma.devServer.findMany({ where: { env }, select: { server_name: true } }),
        );
        serverNames = allRecords.map((r) => r.server_name);
      } else {
        const projectConfiguration = yield* ProjectConfiguration;
        const serversToStop =
          filterServers.length > 0
            ? projectConfiguration.servers.filter((s) => filterServers.includes(s.name))
            : projectConfiguration.servers;
        serverNames = serversToStop.map((s) => s.name);
      }

      const records = yield* Effect.promise(() =>
        prisma.devServer.findMany({
          where: { env, server_name: { in: serverNames } },
        }),
      );

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
    }),
).pipe(Command.provide(ProjectConfigurationLive));
