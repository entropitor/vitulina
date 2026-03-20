import { FetchHttpClient, FileSystem, HttpClient, HttpClientRequest } from "@effect/platform";
import { Console, Effect } from "effect";
import { execSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { VERSION } from "../version.js";

export const PROXY_PORT = 4000;

const proxyLogDir = path.join(process.env["TMPDIR"] ?? os.tmpdir(), "vitulina");
const proxyStdoutLog = path.join(proxyLogDir, "proxy.stdout.log");
const proxyStderrLog = path.join(proxyLogDir, "proxy.stderr.log");

export const proxyLogPaths = { dir: proxyLogDir, stdout: proxyStdoutLog, stderr: proxyStderrLog };

export const stopProxy = Effect.gen(function* () {
  let pids: number[];
  try {
    const output = execSync(`lsof -ti tcp:${PROXY_PORT}`, { encoding: "utf-8" });
    pids = output
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map(Number);
  } catch {
    pids = [];
  }

  if (pids.length === 0) {
    yield* Console.log("No proxy process found");
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      yield* Console.log(`Stopped proxy process (pid ${pid})`);
    } catch {
      yield* Console.log(`Could not kill pid ${pid} (already dead?)`);
    }
  }
});

export const ensureProxy = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;

  const needsRestart = yield* client
    .execute(HttpClientRequest.get(`http://localhost:${PROXY_PORT}/vitulina.json`))
    .pipe(
      Effect.flatMap((res) => res.json),
      Effect.map((body) => {
        const { version } = body as { version: string };
        return version !== VERSION;
      }),
      Effect.catchAll(() => Effect.succeed(true)),
    );

  if (!needsRestart) {
    return;
  }

  yield* stopProxy;

  yield* fs.makeDirectory(proxyLogDir, { recursive: true });

  const proc = Bun.spawn([process.execPath, process.argv[1], "proxy", "start"], {
    stdout: Bun.file(proxyStdoutLog),
    stderr: Bun.file(proxyStderrLog),
  });
  proc.unref();

  yield* Console.log(`Proxy (re)started (pid ${proc.pid})`);
}).pipe(Effect.provide(FetchHttpClient.layer));
