import { Args, Options } from "@effect/cli";
import { Effect, Option } from "effect";
import type { DevServerWhereInput } from "../generated/prisma/models/DevServer.js";
import { ProjectConfiguration } from "../services/Config.js";
import { getJjWorkspaceName } from "../util/jj.js";

export const projectOption = Options.text("project").pipe(Options.withAlias("p"), Options.optional);

export const envOption = Options.text("env").pipe(Options.optional);

export const serverFilter = Args.repeated(Args.text({ name: "server" }));

export const detachOption = Options.boolean("detach").pipe(Options.withAlias("d"));

export const followOption = Options.boolean("follow").pipe(Options.withAlias("f"));

export const allOption = Options.boolean("all").pipe(
  Options.withAlias("a"),
  Options.withDefault(false),
);

export const allServersOption = Options.boolean("all-servers").pipe(
  Options.withAlias("A"),
  Options.withDefault(false),
);

export interface ServerQueryOptions {
  readonly project: Option.Option<string>;
  readonly env: Option.Option<string>;
  readonly all: boolean;
  readonly allServers: boolean;
  readonly servers: ReadonlyArray<string>;
}

export const buildServerWhere = (options: ServerQueryOptions) =>
  Effect.gen(function* () {
    const where: DevServerWhereInput = {};
    const positionalGiven = options.servers.length > 0;

    // -a is nuclear: ignore every other filter except positional.
    // Never touches the config file.
    if (options.all) {
      if (positionalGiven) {
        where.server_name = { in: [...options.servers] };
      }
      return where;
    }

    const envGiven = Option.isSome(options.env);
    const projectGiven = Option.isSome(options.project);
    // --project implies --all-servers: always widen the server filter
    // to every registered server under that project.
    const allServers = options.allServers || projectGiven;

    // Config loading strategy:
    //   - --project given -> never loaded (project is explicit,
    //     env defaults to "any", server list default is off via -A).
    //   - otherwise -> required, existing ConfigError propagates.
    if (projectGiven) {
      where.project_name = options.project.value;

      if (envGiven) {
        where.env = options.env.value;
      }
      // No env auto-detection; --project widens to every env.

      if (positionalGiven) {
        where.server_name = { in: [...options.servers] };
      }
      // No server-list default; --project widens to every server.

      return where;
    }

    const config = yield* ProjectConfiguration;

    // ----- Project ----- (auto-detected from the current config)
    where.project_name = config.project_name;

    // ----- Env -----
    // Explicit --env wins; otherwise default to the jj workspace.
    if (envGiven) {
      where.env = options.env.value;
    } else {
      where.env = (yield* Effect.promise(() => getJjWorkspaceName())) ?? "default";
    }

    // ----- Servers -----
    // Positional wins. Otherwise the config's server list is used,
    // unless -A (or --project, handled above) disables it.
    if (positionalGiven) {
      where.server_name = { in: [...options.servers] };
    } else if (!allServers) {
      where.server_name = { in: config.servers.map((s) => s.name) };
    }

    return where;
  });
