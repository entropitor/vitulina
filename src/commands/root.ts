import { Command } from "@effect/cli";
import { Console } from "effect";
import { up } from "./up.js";

const rootCmd = Command.make("vitulina", {}, () => Console.log("Hello from vitulina!"));
export const root = rootCmd.pipe(Command.withSubcommands([up]));
