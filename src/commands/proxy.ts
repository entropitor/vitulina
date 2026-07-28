import { Command, Options } from "@effect/cli";
import {
  FetchHttpClient,
  FileSystem,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Socket,
} from "@effect/platform";
import { BunHttpServer, BunSocket } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { cyan, httpStatusColor, magentaBright, serviceColor, yellow } from "../colors.js";
import { Prisma } from "../Prisma.js";
import { GlobalConfiguration } from "../services/Config.js";
import { ProjectIndexLive, ProjectIndexService } from "../services/ProjectIndex.js";
import { printLogFile, tailFile } from "../util/log.js";
import { PROXY_PORT, proxyLogPaths, stopProxy } from "../util/proxy.js";
import { VERSION } from "../version.js";

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

const forwardRequest = (targetUrl: string, hostOverride?: string) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const client = yield* HttpClient.HttpClient;

    const contentLength = Headers.get(req.headers, "content-length").pipe(Option.getOrUndefined);
    const hasBody =
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      req.method !== "OPTIONS" &&
      contentLength != null &&
      contentLength !== "0";
    const contentType = Headers.get(req.headers, "content-type").pipe(Option.getOrUndefined);

    const proxyReq = HttpClientRequest.make(req.method)(targetUrl).pipe(
      HttpClientRequest.setHeaders(req.headers),
      hostOverride ? HttpClientRequest.setHeader("host", hostOverride) : (r) => r,
      hasBody ? HttpClientRequest.bodyStream(req.stream, { contentType }) : (r) => r,
    );

    const response = yield* client.execute(proxyReq).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, {
        decompress: false,
        // A reverse proxy must not follow redirects on the client's behalf: the client needs to
        // see the 3xx so that cookies, history and relative locations resolve against the
        // proxied origin. It also cannot follow them here — the second hop would have to replay
        // the request body, and `bodyStream` above is a ReadableStream, which Bun refuses to
        // replay ("Request body is a ReadableStream and cannot be replayed for this redirect").
        redirect: "manual",
      } as RequestInit),
    );

    return HttpServerResponse.stream(response.stream, {
      status: response.status,
      headers: response.headers,
    });
  });

const bridgeSockets = (a: Socket.Socket, b: Socket.Socket) =>
  Effect.scoped(
    Effect.gen(function* () {
      const writeToB = yield* b.writer;
      const writeToA = yield* a.writer;
      yield* Effect.all([a.runRaw((data) => writeToB(data)), b.runRaw((data) => writeToA(data))], {
        concurrency: 2,
      });
    }),
  );

const wsProxyHandler = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const projectIndex = yield* ProjectIndexService;
  const prisma = yield* Prisma;

  const host = Headers.get(req.headers, "host").pipe(Option.getOrElse(() => ""));
  const hostName = host.split(":")[0];

  const match = yield* projectIndex.lookup(hostName);
  if (!match) {
    return HttpServerResponse.text(`No project match for host "${hostName}"\n`, { status: 502 });
  }

  const svcClr = serviceColor(match.serverName);

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

  let targetUrl: string;
  let label: string;

  if (!target) {
    if (Option.isSome(match.project.upstream_proxy_domain)) {
      const upstreamHost = `${match.serverName}.${match.project.upstream_proxy_domain.value}`;
      targetUrl = `wss://${upstreamHost}${req.url}`;
      label = yellow("upstream");
    } else {
      return HttpServerResponse.text(
        `No server registered for ${match.serverName}.${match.env} in project "${match.project.name}"\n`,
        { status: 502 },
      );
    }
  } else {
    targetUrl = `ws://localhost:${target.port}${req.url}`;
    label = cyan("local");
  }

  yield* Console.log(
    `  ${svcClr(match.serverName)} -> ${label} ${magentaBright("WS")} ${targetUrl}`,
  );

  const protocols = Headers.get(req.headers, "sec-websocket-protocol").pipe(
    Option.map((p) => p.split(",").map((s) => s.trim())),
    Option.getOrUndefined,
  );

  const incomingSocket = yield* HttpServerRequest.upgrade;
  const targetSocket = yield* Socket.makeWebSocket(targetUrl, { protocols });

  yield* bridgeSockets(incomingSocket, targetSocket);

  return HttpServerResponse.empty();
});

const proxyHandler = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const prisma = yield* Prisma;
  const projectIndex = yield* ProjectIndexService;

  const host = Headers.get(req.headers, "host").pipe(Option.getOrElse(() => ""));
  const hostName = host.split(":")[0];

  const upgradeHeader = Headers.get(req.headers, "upgrade").pipe(Option.getOrElse(() => ""));
  if (upgradeHeader.toLowerCase() === "websocket") {
    yield* Console.log(`WS ${host}${req.url}`);
    return yield* wsProxyHandler;
  }

  yield* Console.log(`${req.method} ${host}${req.url}`);

  const match = yield* projectIndex.lookup(hostName);
  if (!match) {
    return HttpServerResponse.text(`No project match for host "${hostName}"\n`, { status: 502 });
  }

  const svcClr = serviceColor(match.serverName);

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

      const upstreamRes = yield* forwardRequest(upstreamUrl, upstreamHost);
      const sc = httpStatusColor(upstreamRes.status);

      yield* Console.log(
        `  ${svcClr(match.serverName)} -> ${yellow("upstream")} ${sc(String(upstreamRes.status))} ${upstreamUrl}`,
      );

      return upstreamRes;
    }

    return HttpServerResponse.text(
      `No server registered for ${match.serverName}.${match.env} in project "${match.project.name}"\n`,
      { status: 502 },
    );
  }

  const targetUrl = `http://localhost:${target.port}${req.url}`;

  const localRes = yield* forwardRequest(targetUrl);
  const sc = httpStatusColor(localRes.status);

  yield* Console.log(
    `  ${svcClr(match.serverName)} -> ${cyan("local")} ${sc(String(localRes.status))} ${targetUrl}`,
  );

  return localRes;
}).pipe(
  Effect.catchAll((error) => {
    const url = error instanceof HttpClientError.RequestError ? ` (${error.methodAndUrl})` : "";
    const detail =
      error instanceof HttpClientError.RequestError && error.cause
        ? String(error.cause)
        : String(error);
    return Effect.succeed(
      HttpServerResponse.text(`Proxy error${url}: ${detail}\n`, {
        status: 502,
      }),
    );
  }),
);

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/proxy.pac", pacHandler),
  HttpRouter.get("/vitulina.json", HttpServerResponse.json({ version: VERSION })),
  HttpRouter.all("*", proxyHandler),
);

const ServerLive = router.pipe(
  HttpServer.serve(),
  Layer.provide(BunHttpServer.layer({ port: PROXY_PORT })),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(BunSocket.layerWebSocketConstructor),
);

const proxyStart = Command.make("start", {}, () =>
  Effect.gen(function* () {
    yield* Console.log(`Reverse proxy listening on http://localhost:${PROXY_PORT}`);
    yield* Console.log(`PAC file available at http://localhost:${PROXY_PORT}/proxy.pac`);
    yield* Layer.launch(ServerLive);
  }),
).pipe(Command.provide(ProjectIndexLive));

const proxyStop = Command.make("stop", {}, () => stopProxy);

const followOption = Options.boolean("follow").pipe(Options.withAlias("f"));

const proxyLogs = Command.make("logs", { follow: followOption }, ({ follow }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (follow) {
      yield* Effect.fork(tailFile(fs, proxyLogPaths.stdout, "proxy", false));
      yield* Effect.fork(tailFile(fs, proxyLogPaths.stderr, "proxy", true));
      yield* Effect.never;
    } else {
      yield* printLogFile(fs, proxyLogPaths.stdout, "proxy", false);
      yield* printLogFile(fs, proxyLogPaths.stderr, "proxy", true);
    }
  }),
);

const proxyCmd = Command.make("proxy", {}, () =>
  Console.log("Usage: vitulina proxy <start|stop|logs>"),
);
export const proxy = proxyCmd.pipe(Command.withSubcommands([proxyStart, proxyStop, proxyLogs]));
