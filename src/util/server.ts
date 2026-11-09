import os from "node:os";
import path from "node:path";
import { PROXY_PORT } from "./proxy.js";

export const logDirectory = () => path.join(process.env["TMPDIR"] ?? os.tmpdir(), "vitulina");

export const serverLocation = (server: string, env: string, domainSuffix: string) => {
  const hostName = `${server}.${env}.${domainSuffix}`;
  const logDir = logDirectory();
  return {
    hostName,
    url: `http://${hostName}:${PROXY_PORT}`,
    stdoutLogPath: path.join(logDir, `${hostName}.stdout.log`),
    stderrLogPath: path.join(logDir, `${hostName}.stderr.log`),
  };
};
