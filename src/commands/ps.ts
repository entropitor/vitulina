import { Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { Prisma } from "../Prisma.js";
import { GlobalConfiguration, ProjectConfigurationLive } from "../services/Config.js";
import { isProcessAlive } from "../util/process.js";
import {
  allOption,
  allServersOption,
  buildServerWhere,
  envOption,
  projectOption,
  serverFilter,
} from "./shared.js";

export const ps = Command.make(
  "ps",
  {
    project: projectOption,
    env: envOption,
    all: allOption,
    allServers: allServersOption,
    servers: serverFilter,
  },
  ({ project, env, all, allServers, servers }) =>
    Effect.gen(function* () {
      const globalConfig = yield* GlobalConfiguration;
      const prisma = yield* Prisma;

      const where = yield* buildServerWhere({ project, env, all, allServers, servers });

      const allRecords = yield* Effect.promise(() =>
        prisma.devServer.findMany({
          where,
          orderBy: [{ project_name: "asc" }, { env: "asc" }, { server_name: "asc" }],
        }),
      );

      // Remove stale records for processes that are no longer running
      const staleIds: number[] = [];
      const records = allRecords.filter((s) => {
        if (isProcessAlive(s.pid)) {
          return true;
        }
        staleIds.push(s.id);
        return false;
      });

      if (staleIds.length > 0) {
        yield* Effect.promise(() =>
          prisma.devServer.deleteMany({ where: { id: { in: staleIds } } }),
        );
      }

      if (records.length === 0) {
        yield* Console.log("No running dev servers.");
        return;
      }

      // Group by project, then by env
      const byProject = new Map<string, Map<string, typeof records>>();
      for (const server of records) {
        let envMap = byProject.get(server.project_name);
        if (!envMap) {
          envMap = new Map();
          byProject.set(server.project_name, envMap);
        }
        let envServers = envMap.get(server.env);
        if (!envServers) {
          envServers = [];
          envMap.set(server.env, envServers);
        }
        envServers.push(server);
      }

      for (const [projectName, envMap] of byProject) {
        const projectEntry = globalConfig.projects.find((p) => p.name === projectName);
        const suffix = projectEntry ? ` (${projectEntry.domain_suffix})` : "";
        yield* Console.log(`${projectName}${suffix}`);

        for (const [envName, envServers] of envMap) {
          yield* Console.log(`  ${envName}`);
          for (const s of envServers) {
            yield* Console.log(`    ${s.server_name}  port=${s.port}  pid=${s.pid}`);
          }
        }
      }
    }).pipe(Effect.provide(ProjectConfigurationLive)),
);
