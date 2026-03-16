import { BunContext } from "@effect/platform-bun";
import { Context, Effect, Layer, Ref } from "effect";
import { GlobalConfiguration, GlobalConfigurationLive, type ProjectEntry } from "./Config.js";

export interface ProjectMatch {
  serverName: string;
  env: string;
  project: ProjectEntry;
}

interface ProjectIndex {
  readonly lookup: (host: string) => Effect.Effect<ProjectMatch | null>;
}

export class ProjectIndexService extends Context.Tag("ProjectIndex")<
  ProjectIndexService,
  ProjectIndex
>() {}

const buildSuffixIndex = Effect.fn("buildSuffixIndex")(function* () {
  const globalConfig = yield* GlobalConfiguration;
  const index = new Map<string, ProjectEntry>();
  for (const project of globalConfig.projects) {
    index.set(project.domain_suffix, project);
  }
  return index;
});

function findProject(host: string, suffixIndex: Map<string, ProjectEntry>): ProjectMatch | null {
  const parts = host.split(".");
  if (parts.length < 3) {
    return null;
  }

  const [serverName, env, ...rest] = parts;
  const suffix = rest.join(".");

  const project = suffixIndex.get(suffix);
  if (!project) {
    return null;
  }

  return { serverName, env, project };
}

const ProjectIndexLayer = Layer.effect(
  ProjectIndexService,
  Effect.gen(function* () {
    const indexRef = yield* Ref.make(yield* buildSuffixIndex());

    const refresh = buildSuffixIndex().pipe(
      Effect.provide(GlobalConfigurationLive),
      Effect.provide(BunContext.layer),
      Effect.option,
      Effect.flatMap((fresh) => {
        if (fresh._tag === "Some") {
          return Ref.set(indexRef, fresh.value);
        }
        return Effect.void;
      }),
    );

    const lookup = (host: string) =>
      Effect.gen(function* () {
        const index = yield* Ref.get(indexRef);
        const match = findProject(host, index);
        if (match) {
          return match;
        }

        yield* refresh;
        const refreshed = yield* Ref.get(indexRef);
        return findProject(host, refreshed);
      });

    return { lookup };
  }),
);

export const ProjectIndexLive = ProjectIndexLayer.pipe(
  Layer.provide(GlobalConfigurationLive),
  Layer.provide(BunContext.layer),
);
