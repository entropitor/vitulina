# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm run dev` — run CLI via bun (for development)
- `pnpm run build` — compile TypeScript with tsgo
- `pnpm run types` — type-check without emitting (tsgo --noEmit)
- `pnpm run lint` / `pnpm run lint:fix` — lint with oxlint
- `pnpm run format` / `pnpm run format:check` — format with oxfmt
- `pnpm run ci` — runs types + lint + format:check (also runs as a stop hook)

## Architecture

ESM Node.js CLI built with **Effect** and **@effect/cli**, run via **Bun**.

- `src/main.ts` — entry point; wires the root command to `BunRuntime` with `BunContext.layer`
- `src/commands/root.ts` — root command definition using `Command.make`
- New subcommands go in `src/commands/` and get composed into the root command

Commands are defined with `Command.make` from `@effect/cli`. The CLI runner in `main.ts` provides the Bun platform layer — all commands receive platform services (filesystem, terminal, etc.) through Effect's dependency injection.

## Tooling

- **tsgo** (`@typescript/native-preview`) for type checking and building — not `tsc`
- **oxlint** for linting — not `eslint`
- **oxfmt** for formatting — not `prettier`
- **bun** as the runtime — not `node` or `tsx`
- **pnpm** as the package manager

## Conventions

- Use `.js` extensions in TypeScript imports (ESM resolution)
- Output goes to `dist/`; source lives in `src/`
