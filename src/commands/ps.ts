import { Command } from "@effect/cli";
import { Console, Effect } from "effect";
import { Prisma } from "../Prisma.js";
import { GlobalConfiguration } from "../services/Config.js";

export const ps = Command.make("ps", {}, () =>
  Effect.gen(function* () {
    const globalConfig = yield* GlobalConfiguration;
    const prisma = yield* Prisma;

    const servers = yield* Effect.promise(() =>
      prisma.devServer.findMany({
        orderBy: [{ project_name: "asc" }, { env: "asc" }, { server_name: "asc" }],
      }),
    );

    if (servers.length === 0) {
      yield* Console.log("No running dev servers.");
      return;
    }

    // Group by project, then by env
    const byProject = new Map<string, Map<string, typeof servers>>();
    for (const server of servers) {
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

      for (const [env, envServers] of envMap) {
        yield* Console.log(`  ${env}`);
        for (const s of envServers) {
          yield* Console.log(`    ${s.server_name}  port=${s.port}  pid=${s.pid}`);
        }
      }
    }
  }),
);
