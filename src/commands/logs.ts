import { Command } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import os from "node:os";
import path from "node:path";
import { Prisma } from "../Prisma.js";
import { ConfigError, GlobalConfiguration, ProjectConfigurationLive } from "../services/Config.js";
import { printLogFile, tailFile } from "../util/log.js";
import {
  allOption,
  allServersOption,
  buildServerWhere,
  envOption,
  followOption,
  projectOption,
  serverFilter,
} from "./shared.js";

export const logs = Command.make(
  "logs",
  {
    project: projectOption,
    env: envOption,
    follow: followOption,
    all: allOption,
    allServers: allServersOption,
    servers: serverFilter,
  },
  ({ project, env, follow, all, allServers, servers }) =>
    Effect.gen(function* () {
      const globalConfiguration = yield* GlobalConfiguration;
      const prisma = yield* Prisma;
      const fs = yield* FileSystem.FileSystem;

      const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
      const logDir = path.join(tmpDir, "vitulina");

      const where = yield* buildServerWhere({ project, env, all, allServers, servers });

      const records = yield* Effect.promise(() => prisma.devServer.findMany({ where }));

      if (records.length === 0) {
        yield* Console.log("No matching servers found.");
        return;
      }

      const serverLogs = records.map((s) => {
        const projectEntry = globalConfiguration.projects.find((p) => p.name === s.project_name);
        if (!projectEntry) {
          throw new ConfigError({
            message: `Project "${s.project_name}" not found in global config`,
          });
        }
        const hostName = `${s.server_name}.${s.env}.${projectEntry.domain_suffix}`;
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
    }).pipe(Effect.provide(ProjectConfigurationLive)),
);
