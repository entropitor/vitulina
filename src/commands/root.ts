import { Command } from "@effect/cli";
import { Console } from "effect";

export const root = Command.make("vitulina", {}, () => Console.log("Hello from vitulina!"));
