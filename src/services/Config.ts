import { Context, Data, Effect, Layer, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { parse } from "yaml";
import path from "node:path";
import os from "node:os";

// --- Schemas ---

const ProjectEntrySchema = Schema.Struct({
  name: Schema.String,
  domain_suffix: Schema.String,
  upstream_proxy_domain: Schema.optionalWith(Schema.String, { as: "Option" }),
});

const GlobalConfigSchema = Schema.Struct({
  projects: Schema.Array(ProjectEntrySchema),
});

const ServerEntrySchema = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
});

const ProjectConfigSchema = Schema.Struct({
  project_name: Schema.String,
  servers: Schema.Array(ServerEntrySchema),
});

// --- Types ---

export type ProjectEntry = typeof ProjectEntrySchema.Type;
export type GlobalConfig = typeof GlobalConfigSchema.Type;
export type ServerEntry = typeof ServerEntrySchema.Type;
export type ProjectConfig = typeof ProjectConfigSchema.Type;

// --- Errors ---

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

// --- Tags ---

export class GlobalConfiguration extends Context.Tag("GlobalConfiguration")<
  GlobalConfiguration,
  GlobalConfig
>() {}

export class ProjectConfiguration extends Context.Tag("ProjectConfiguration")<
  ProjectConfiguration,
  ProjectConfig & { readonly projectRoot: string }
>() {}

// --- Layers ---

const configDir = process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config");
const globalConfigPath = path.join(configDir, "vitulina", "config.yaml");

export const GlobalConfigurationLive = Layer.effect(
  GlobalConfiguration,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(globalConfigPath).pipe(
      Effect.mapError(
        () =>
          new ConfigError({
            message: `Global config not found: ${globalConfigPath}`,
          }),
      ),
    );
    const parsed = parse(raw);
    return yield* Schema.decodeUnknown(GlobalConfigSchema)(parsed).pipe(
      Effect.mapError(
        (e) =>
          new ConfigError({
            message: `Invalid global config: ${e.message}`,
          }),
      ),
    );
  }),
);

const walkUpForConfig = (
  fs: FileSystem.FileSystem,
  startDir: string,
): Effect.Effect<{ readonly configPath: string; readonly projectRoot: string }, ConfigError> =>
  Effect.gen(function* () {
    let current = path.resolve(startDir);
    while (true) {
      const candidate = path.join(current, ".vitulina.yaml");
      const exists = yield* fs.exists(candidate).pipe(
        Effect.mapError(
          () =>
            new ConfigError({
              message: `Failed to check for config at ${candidate}`,
            }),
        ),
      );
      if (exists) {
        return { configPath: candidate, projectRoot: current };
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return yield* new ConfigError({
          message: `No .vitulina.yaml found in ${startDir} or any parent directory`,
        });
      }
      current = parent;
    }
  });

export const ProjectConfigurationLive = Layer.effect(
  ProjectConfiguration,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { configPath, projectRoot } = yield* walkUpForConfig(fs, process.cwd());
    const raw = yield* fs.readFileString(configPath).pipe(
      Effect.mapError(
        () =>
          new ConfigError({
            message: `Project config not found: ${configPath}`,
          }),
      ),
    );
    const parsed = parse(raw);
    const config = yield* Schema.decodeUnknown(ProjectConfigSchema)(parsed).pipe(
      Effect.mapError(
        (e) =>
          new ConfigError({
            message: `Invalid project config: ${e.message}`,
          }),
      ),
    );
    return { ...config, projectRoot };
  }),
);
