import { Args, Command, Options } from "@effect/cli";
import { Command as PlatformCommand, FileSystem } from "@effect/platform";
import { Console, Effect, Stream } from "effect";
import os from "node:os";
import path from "node:path";
import {
  ConfigError,
  GlobalConfiguration,
  GlobalConfigurationLive,
  ProjectConfiguration,
  ProjectConfigurationLive,
} from "../services/Config.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { Prisma } from "../Prisma.js";
import { acquirePort } from "../util/port.js";
import { getJjWorkspaceName } from "../util/jj.js";
import { isProcessAlive } from "../util/process.js";
import { PROXY_PORT } from "./proxy.js";

const envOption = Options.text("env").pipe(
  Options.withDefault((await getJjWorkspaceName()) ?? "default"),
);

const detachOption = Options.boolean("detach").pipe(Options.withAlias("d"));

const serverFilter = Args.repeated(Args.text({ name: "server" }));

export const up = Command.make(
  "up",
  { env: envOption, detach: detachOption, servers: serverFilter },
  ({ env, detach, servers: filterServers }) =>
    Effect.gen(function* () {
      const globalConfiguration = yield* GlobalConfiguration;
      const projectConfiguration = yield* ProjectConfiguration;
      const prisma = yield* Prisma;
      const fs = yield* FileSystem.FileSystem;
      const cwd = process.cwd();

      const projectEntry = globalConfiguration.projects.find(
        (p) => p.name === projectConfiguration.project_name,
      );
      if (!projectEntry) {
        return yield* new ConfigError({
          message: `Project "${projectConfiguration.project_name}" not found in global config`,
        });
      }
      const { domain_suffix } = projectEntry;

      const tmpDir = process.env["TMPDIR"] ?? os.tmpdir();
      const logDir = path.join(tmpDir, "vitulina");
      yield* fs.makeDirectory(logDir, { recursive: true });

      const candidateServers =
        filterServers.length > 0
          ? projectConfiguration.servers.filter((s) => filterServers.includes(s.name))
          : projectConfiguration.servers;

      if (candidateServers.length === 0) {
        return yield* Console.error("No servers to start");
      }

      const candidateNames = candidateServers.map((s) => s.name);
      const existingRecords = yield* Effect.promise(() =>
        prisma.devServer.findMany({
          where: {
            project_name: projectConfiguration.project_name,
            env,
            server_name: { in: candidateNames },
          },
        }),
      );

      const staleIds: number[] = [];
      const aliveNames = new Set<string>();
      for (const record of existingRecords) {
        if (isProcessAlive(record.pid)) {
          aliveNames.add(record.server_name);
          yield* Console.log(`${record.server_name} already running (pid ${record.pid}), skipping`);
        } else {
          staleIds.push(record.id);
          yield* Console.log(
            `${record.server_name} (pid ${record.pid}) is dead, cleaning up stale record`,
          );
        }
      }

      if (staleIds.length > 0) {
        yield* Effect.promise(() =>
          prisma.devServer.deleteMany({ where: { id: { in: staleIds } } }),
        );
      }

      const serversToStart = candidateServers.filter((s) => !aliveNames.has(s.name));

      if (serversToStart.length === 0) {
        return yield* Console.log("All servers already running");
      }

      const params: StartParams = {
        serversToStart,
        env,
        cwd,
        logDir,
        domain_suffix,
        projectName: projectConfiguration.project_name,
        prisma,
      };

      if (detach) {
        yield* startDetached(params);
      } else {
        yield* startForeground(params);
      }
    }),
).pipe(Command.provide(GlobalConfigurationLive), Command.provide(ProjectConfigurationLive));

interface StartParams {
  serversToStart: ReadonlyArray<{ name: string; command: string }>;
  env: string;
  cwd: string;
  logDir: string;
  domain_suffix: string;
  projectName: string;
  prisma: PrismaClient;
}

interface ServerContext {
  server: { name: string; command: string };
  port: number;
  hostName: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  env: Record<string, string>;
}

const prepareServer = (params: StartParams, server: { name: string; command: string }) =>
  Effect.gen(function* () {
    const port = yield* acquirePort;
    const hostName = `${server.name}.${params.env}.${params.domain_suffix}`;
    const stdoutLogPath = path.join(params.logDir, `${hostName}.stdout.log`);
    const stderrLogPath = path.join(params.logDir, `${hostName}.stderr.log`);
    return {
      server,
      port,
      hostName,
      stdoutLogPath,
      stderrLogPath,
      env: {
        ...process.env,
        PORT: String(port),
        VITULINA_ENV: params.env,
        VITULINA_PROXY_PORT: String(PROXY_PORT),
      },
    } satisfies ServerContext;
  });

const registerServer = (params: StartParams, ctx: ServerContext, pid: number) =>
  Effect.promise(() =>
    params.prisma.devServer.upsert({
      where: {
        project_name_env_server_name: {
          project_name: params.projectName,
          env: params.env,
          server_name: ctx.server.name,
        },
      },
      update: { pid, port: ctx.port, working_directory: params.cwd },
      create: {
        project_name: params.projectName,
        env: params.env,
        server_name: ctx.server.name,
        pid,
        port: ctx.port,
        working_directory: params.cwd,
      },
    }),
  );

const startDetached = (params: StartParams) =>
  Effect.gen(function* () {
    for (const server of params.serversToStart) {
      const ctx = yield* prepareServer(params, server);

      const proc = Bun.spawn(["sh", "-c", server.command], {
        cwd: params.cwd,
        env: ctx.env,
        stdout: Bun.file(ctx.stdoutLogPath),
        stderr: Bun.file(ctx.stderrLogPath),
      });
      proc.unref();

      yield* registerServer(params, ctx, proc.pid);
      yield* Console.log(`Started ${server.name} on port ${ctx.port} (pid ${proc.pid}) [detached]`);
      yield* Console.log(`  hostname: ${ctx.hostName}`);
      yield* Console.log(`  stdout: ${ctx.stdoutLogPath}`);
      yield* Console.log(`  stderr: ${ctx.stderrLogPath}`);
    }
  });

const startForeground = (params: StartParams) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const processes: Array<{ name: string; port: number; pid: number }> = [];

    for (const server of params.serversToStart) {
      const ctx = yield* prepareServer(params, server);

      const cmd = PlatformCommand.make("sh", "-c", server.command).pipe(
        PlatformCommand.env(ctx.env),
        PlatformCommand.workingDirectory(params.cwd),
      );

      const proc = yield* PlatformCommand.start(cmd);
      const pid = proc.pid as unknown as number;
      processes.push({ name: server.name, port: ctx.port, pid });

      yield* registerServer(params, ctx, pid);

      yield* proc.stdout.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            const text = new TextDecoder().decode(chunk);
            yield* Console.log(`[${server.name}] ${text}`);
            yield* fs.writeFile(ctx.stdoutLogPath, chunk, { flag: "a" });
          }),
        ),
        Effect.fork,
      );

      yield* proc.stderr.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            const text = new TextDecoder().decode(chunk);
            yield* Console.error(`[${server.name}] ${text}`);
            yield* fs.writeFile(ctx.stderrLogPath, chunk, { flag: "a" });
          }),
        ),
        Effect.fork,
      );
    }

    yield* Console.log("Started servers:");
    for (const s of processes) {
      yield* Console.log(`  ${s.name} -> port ${s.port} (pid ${s.pid})`);
    }

    const startedServerNames = processes.map((s) => s.name);
    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        params.prisma.devServer.deleteMany({
          where: {
            project_name: params.projectName,
            env: params.env,
            server_name: { in: startedServerNames },
          },
        }),
      ),
    );

    yield* Effect.never;
  }).pipe(Effect.scoped);
