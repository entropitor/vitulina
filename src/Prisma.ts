import { PrismaLibSql } from "@prisma/adapter-libsql";
import { Context, Effect, Layer } from "effect";
import { PrismaClient } from "./generated/prisma/client.js";
import { dbUrl } from "./config.js";

export class Prisma extends Context.Tag("Prisma")<Prisma, PrismaClient>() {}

export const PrismaLive = Layer.scoped(
  Prisma,
  Effect.acquireRelease(
    Effect.sync(() => {
      const adapter = new PrismaLibSql({ url: dbUrl });
      return new PrismaClient({ adapter });
    }),
    (client) => Effect.promise(() => client.$disconnect()),
  ),
);
