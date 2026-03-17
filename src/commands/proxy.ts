import { Command } from "@effect/cli";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { BunHttpServer } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { GlobalConfiguration } from "../services/Config.js";
import { Prisma } from "../Prisma.js";
import { ProjectIndexLive, ProjectIndexService } from "../services/ProjectIndex.js";

const PROXY_PORT = 4000;

const generatePacFile = Effect.fn("generatePacFile")(function* () {
  const globalConfig = yield* GlobalConfiguration;
  const conditions = globalConfig.projects
    .map((p) => `dnsDomainIs(host, '.${p.domain_suffix}')`)
    .join(" || ");

  return `function FindProxyForURL(url, host) {
  if (${conditions}) {
    return 'PROXY 127.0.0.1:${PROXY_PORT}';
  }

  return 'DIRECT';
}`;
});

const pacHandler = generatePacFile().pipe(
  Effect.map((pac) =>
    HttpServerResponse.text(pac, {
      contentType: "application/x-javascript-config",
    }),
  ),
  Effect.catchAll((err) =>
    Effect.succeed(
      HttpServerResponse.text(`Failed to read config: ${err}\n`, {
        status: 500,
      }),
    ),
  ),
);

const proxyHandler = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const client = yield* HttpClient.HttpClient;
  const prisma = yield* Prisma;
  const projectIndex = yield* ProjectIndexService;

  const host = Headers.get(req.headers, "host").pipe(Option.getOrElse(() => ""));
  const hostName = host.split(":")[0];

  yield* Console.log(`${req.method} ${host}${req.url}`);

  const match = yield* projectIndex.lookup(hostName);
  if (!match) {
    return HttpServerResponse.text(`No project match for host "${hostName}"\n`, { status: 502 });
  }

  const target = yield* Effect.promise(() =>
    prisma.devServer.findUnique({
      where: {
        project_name_env_server_name: {
          project_name: match.project.name,
          env: match.env,
          server_name: match.serverName,
        },
      },
    }),
  );

  if (!target) {
    if (Option.isSome(match.project.upstream_proxy_domain)) {
      const upstreamHost = `${match.serverName}.${match.project.upstream_proxy_domain.value}`;
      const upstreamUrl = `https://${upstreamHost}${req.url}`;

      yield* Console.log(`  -> upstream ${upstreamUrl}`);

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const proxyReq = HttpClientRequest.make(req.method)(upstreamUrl).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.setHeader("host", upstreamHost),
        hasBody ? HttpClientRequest.bodyStream(req.stream) : (r) => r,
      );

      const response = yield* client.execute(proxyReq).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, {
          decompress: false,
          redirect: "manual",
        } as RequestInit),
      );

      return HttpServerResponse.stream(response.stream, {
        status: response.status,
        headers: response.headers,
      });
    }

    return HttpServerResponse.text(
      `No server registered for ${match.serverName}.${match.env} in project "${match.project.name}"\n`,
      { status: 502 },
    );
  }

  const targetUrl = `http://127.0.0.1:${target.port}${req.url}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const proxyReq = HttpClientRequest.make(req.method)(targetUrl).pipe(
    HttpClientRequest.setHeaders(req.headers),
    hasBody ? HttpClientRequest.bodyStream(req.stream) : (r) => r,
  );

  const response = yield* client.execute(proxyReq);

  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers: response.headers,
  });
}).pipe(
  Effect.catchAll((error) =>
    Effect.succeed(HttpServerResponse.text(`Proxy error: ${error}\n`, { status: 502 })),
  ),
);

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/proxy.pac", pacHandler),
  HttpRouter.all("*", proxyHandler),
);

const ServerLive = router.pipe(
  HttpServer.serve(),
  Layer.provide(BunHttpServer.layer({ port: PROXY_PORT })),
  Layer.provide(FetchHttpClient.layer),
);

const proxyStart = Command.make("start", {}, () =>
  Effect.gen(function* () {
    yield* Console.log(`Reverse proxy listening on http://localhost:${PROXY_PORT}`);
    yield* Console.log(`PAC file available at http://localhost:${PROXY_PORT}/proxy.pac`);
    yield* Layer.launch(ServerLive);
  }),
).pipe(Command.provide(ProjectIndexLive));

const proxyCmd = Command.make("proxy", {}, () => Console.log("Usage: vitulina proxy start"));
export const proxy = proxyCmd.pipe(Command.withSubcommands([proxyStart]));
