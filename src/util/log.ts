import { FileSystem } from "@effect/platform";
import { Console, Effect, Ref, Schedule } from "effect";

export const printLogFile = (
  fs: FileSystem.FileSystem,
  filePath: string,
  label: string,
  isStderr: boolean,
) =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      return;
    }
    const content = yield* fs.readFileString(filePath);
    if (content.length === 0) {
      return;
    }
    const log = isStderr ? Console.error : Console.log;
    for (const line of content.split("\n")) {
      if (line.length > 0) {
        yield* log(`[${label}] ${line}`);
      }
    }
  });

export const tailFile = (
  fs: FileSystem.FileSystem,
  filePath: string,
  label: string,
  isStderr: boolean,
) =>
  Effect.gen(function* () {
    const offset = yield* Ref.make(0);
    const log = isStderr ? Console.error : Console.log;

    yield* Effect.repeat(
      Effect.gen(function* () {
        const exists = yield* fs.exists(filePath);
        if (!exists) {
          return;
        }
        const content = yield* fs.readFile(filePath);
        const currentOffset = yield* Ref.get(offset);
        if (content.byteLength > currentOffset) {
          const newContent = new TextDecoder().decode(content.slice(currentOffset));
          yield* Ref.set(offset, content.byteLength);
          for (const line of newContent.split("\n")) {
            if (line.length > 0) {
              yield* log(`[${label}] ${line}`);
            }
          }
        }
      }),
      Schedule.spaced("100 millis"),
    );
  });
