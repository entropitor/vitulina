import { Effect } from "effect";
import net from "node:net";

export const acquirePort = Effect.async<number, Error>((resume) => {
  const server = net.createServer();
  server.listen(0, () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    server.close(() => resume(Effect.succeed(port)));
  });
  server.on("error", (err) => resume(Effect.fail(err)));
});

export const waitForPort = (port: number, timeoutMs = 30_000) =>
  Effect.async<void, Error>((resume) => {
    const start = Date.now();
    const hosts = ["127.0.0.1", "::1"];
    let activeSockets: net.Socket[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const cleanup = () => {
      for (const s of activeSockets) {
        s.destroy();
      }
      activeSockets = [];
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const finish = (e: Effect.Effect<void, Error>) => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      resume(e);
    };

    const tryConnect = () => {
      if (done) {
        return;
      }
      let remaining = hosts.length;
      activeSockets = hosts.map((host) => {
        const s = net.createConnection({ port, host });
        s.setTimeout(1000, () => s.destroy());
        s.once("connect", () => {
          finish(Effect.void);
        });
        s.once("close", () => {
          remaining--;
          if (remaining === 0 && !done) {
            if (Date.now() - start >= timeoutMs) {
              finish(Effect.fail(new Error(`Timed out waiting for port ${port}`)));
              return;
            }
            retryTimer = setTimeout(tryConnect, 250);
          }
        });
        s.on("error", () => {});
        return s;
      });
    };

    tryConnect();

    return Effect.sync(() => finish(Effect.fail(new Error("cancelled"))));
  });
