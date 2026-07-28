import { $ } from "bun";
import { getJjWorkspaceName } from "./jj.js";

/**
 * A linked git worktree keeps its gitdir at `<common dir>/worktrees/<name>`. The main worktree
 * has no such name, so it yields nothing and the caller's default applies.
 */
const getGitWorktreeName = async (): Promise<string | undefined> => {
  const result = await $`git rev-parse --git-dir`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return undefined;
  }
  return /[/\\]worktrees[/\\]([^/\\]+)$/.exec(result.text().trim())?.[1];
};

/**
 * The workspace this checkout represents: the jj workspace, falling back to the git worktree
 * name when jj is not installed or the repo is not a jj repo.
 */
export const getWorkspaceName = async (): Promise<string | undefined> =>
  (await getJjWorkspaceName()) ?? (await getGitWorktreeName());
