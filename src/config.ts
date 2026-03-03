import path from "node:path";
import os from "node:os";

const dataDir = process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");

export const dbUrl = process.env["DB_URL"] ?? `file:${path.join(dataDir, "vitulina", "state.db")}`;
