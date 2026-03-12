import { $ } from "bun";

export const getJjWorkspaceName = async (): Promise<string | undefined> => {
  const result =
    await $`jj log -r @ -T 'self.working_copies().map(|w| w.name()).join("\n")' --no-graph`
      .nothrow()
      .quiet();
  if (result.exitCode !== 0) return undefined;
  return result.text().trim().split("\n")[0]?.trim();
};
