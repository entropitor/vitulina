import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect, Ref, Schedule } from "effect";
import os from "node:os";
import path from "node:path";
import {
  ConfigError,
  GlobalConfiguration,
  GlobalConfigurationLive,
  ProjectConfiguration,
  ProjectConfigurationLive,
} from "../services/Config.js";
import { Prisma } from "../Prisma.js";
import { getJjWorkspaceName } from "../util/jj.js";

const envOption = Options.text("env").pipe(
  Options.withDefault((await getJjWorkspaceName()) ?? "default"),
);

const followOption = Options.boolean("follow").pipe(Options.withAlias("f"));

const allOption = Options.boolean("all").pipe(Options.withAlias("a"), Options.withDefault(false));

const serverFilter = Args.repeated(Args.text({ name: "server" }));

export const logs = Command.make(
  "logs",
  { env: envOption, follow: followOption, all: allOption, servers: serverFilter },
  ({ env, follow, all, servers: filterServers }) =>
    Effect.gen(function* () {
      const globalConfiguration = yield* GlobalConfiguration;
      const prisma = yield* Prisma;
      const fs = yield* FileSystem.FileSystem;

      const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
      const logDir = path.join(tmpDir, "vitulina");

      let existingRecords;
      if (all) {
        existingRecords = yield* Effect.promise(() =>
          prisma.devServer.findMany({ where: { env } }),
        );
      } else {
        const projectConfiguration = yield* ProjectConfiguration;
        existingRecords = yield* Effect.promise(() =>
          prisma.devServer.findMany({
            where: {
              project_name: projectConfiguration.project_name,
              env,
            },
          }),
        );
      }

      const servers =
        filterServers.length > 0
          ? existingRecords.filter((s) => filterServers.includes(s.server_name))
          : existingRecords;

      if (servers.length === 0) {
        yield* Console.log("No matching servers found.");
        return;
      }

      const serverLogs = servers.map((s) => {
        const projectEntry = globalConfiguration.projects.find((p) => p.name === s.project_name);
        if (!projectEntry) {
          throw new ConfigError({
            message: `Project "${s.project_name}" not found in global config`,
          });
        }
        const hostName = `${s.server_name}.${env}.${projectEntry.domain_suffix}`;
        return {
          name: s.server_name,
          stdoutPath: path.join(logDir, `${hostName}.stdout.log`),
          stderrPath: path.join(logDir, `${hostName}.stderr.log`),
        };
      });

      if (follow) {
        for (const sl of serverLogs) {
          yield* Effect.fork(tailFile(fs, sl.stdoutPath, sl.name, false));
          yield* Effect.fork(tailFile(fs, sl.stderrPath, sl.name, true));
        }
        yield* Effect.never;
      } else {
        for (const sl of serverLogs) {
          yield* printLogFile(fs, sl.stdoutPath, sl.name, false);
          yield* printLogFile(fs, sl.stderrPath, sl.name, true);
        }
      }
    }),
).pipe(Command.provide(GlobalConfigurationLive), Command.provide(ProjectConfigurationLive));

const printLogFile = (
  fs: FileSystem.FileSystem,
  filePath: string,
  serverName: string,
  isStderr: boolean,
) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      return;
    }
    const content = yield* fs.readFileString(filePath);
    if (content.length === 0) {
      return;
    }
    const log = isStderr ? Console.error : Console.log;
    for (const line of content.split("\n")) {
      if (line.length > 0) {
        yield* log(`[${serverName}] ${line}`);
      }
    }
  });

const tailFile = (
  fs: FileSystem.FileSystem,
  filePath: string,
  serverName: string,
  isStderr: boolean,
) =>
  Effect.gen(function* () {
    const offset = yield* Ref.make(0);
    const log = isStderr ? Console.error : Console.log;

    yield* Effect.repeat(
      Effect.gen(function* () {
        const exists = yield* fs.exists(filePath);
        if (!exists) {
          return;
        }
        const content = yield* fs.readFile(filePath);
        const currentOffset = yield* Ref.get(offset);
        if (content.byteLength > currentOffset) {
          const newContent = new TextDecoder().decode(content.slice(currentOffset));
          yield* Ref.set(offset, content.byteLength);
          for (const line of newContent.split("\n")) {
            if (line.length > 0) {
              yield* log(`[${serverName}] ${line}`);
            }
          }
        }
      }),
      Schedule.spaced("100 millis"),
    );
  });
