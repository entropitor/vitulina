import { Effect } from "effect";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dbUrl } from "./config.js";

const getDbPath = (url: string): string => {
  return url.startsWith("file:") ? url.slice(5) : url;
};

const runStatements = (db: Database, sql: string): void => {
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    db.run(stmt);
  }
};

// In dev this file lives in src/, so migrations are one level up; in the
// built package it lives in dist/src/, so they are two levels up.
const migrationsDirCandidates = [
  path.join(import.meta.dir, "..", "prisma", "migrations"),
  path.join(import.meta.dir, "..", "..", "prisma", "migrations"),
];
const migrationsDir =
  migrationsDirCandidates.find((dir) => fs.existsSync(dir)) ?? migrationsDirCandidates[0];

export const migrate = Effect.sync(() => {
  const dbPath = getDbPath(dbUrl);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "checksum" TEXT NOT NULL DEFAULT '',
        "finished_at" TEXT,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TEXT,
        "started_at" TEXT NOT NULL DEFAULT (datetime('now')),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `);

    const applied = new Set(
      db
        .query('SELECT "migration_name" FROM "_prisma_migrations"')
        .all()
        .map((row) => (row as { migration_name: string }).migration_name),
    );

    if (!fs.existsSync(migrationsDir)) {
      return;
    }

    const migrationDirs = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const dir of migrationDirs) {
      if (applied.has(dir.name)) {
        continue;
      }

      const sqlPath = path.join(migrationsDir, dir.name, "migration.sql");
      if (!fs.existsSync(sqlPath)) {
        continue;
      }

      const sql = fs.readFileSync(sqlPath, "utf-8");
      runStatements(db, sql);

      db.prepare(
        `INSERT INTO "_prisma_migrations" ("id", "migration_name", "checksum", "finished_at", "applied_steps_count")
         VALUES (?, ?, '', datetime('now'), 1)`,
      ).run(crypto.randomUUID(), dir.name);
    }
  } finally {
    db.close();
  }
});
