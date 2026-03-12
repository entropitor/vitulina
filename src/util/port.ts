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
