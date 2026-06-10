# vitulina

A development environment manager and reverse proxy for orchestrating multiple microservices across isolated environments.

Vitulina starts your dev servers, assigns ports automatically, and runs a reverse proxy that routes HTTP and WebSocket requests to the right server based on hostname — so you can run multiple environments side by side without port conflicts.

## Setup

### Install

> **Note:** vitulina currently only runs on [Bun](https://bun.sh) — install Bun first. It will not work under Node.js.

```sh
bun install -g vitulina
```

Installing with `npm install -g vitulina` also works on macOS and Linux as long as `bun` is on your `PATH` (the CLI's entry point runs via Bun). On Windows, use `bun install -g` — npm's shims would try to run the CLI with Node.

### Configuration

**Global config** at `~/.config/vitulina/config.yaml`:

```yaml
projects:
  - name: myproject
    domain_suffix: myproject.localhost
    upstream_proxy_domain: staging-example.com # optional fallback
```

**Project config** at `.vitulina.yaml` in your project root:

```yaml
project_name: myproject
servers:
  - name: api
    command: npm run start:api
  - name: web
    command: npm run start:web
    ui: true
```

Each server gets a hostname like `api.default.myproject.localhost` that the proxy routes to the assigned port.

Setting `ui: true` on a server makes `vitulina up` wait for that server's port to accept connections and then open its URL in the browser.

## Usage

### `vitulina up [server...]`

Start development servers for the current project.

```sh
vitulina up              # start all servers
vitulina up api          # start only the "api" server
vitulina up --detach     # start in background
vitulina up --env feat   # start in the "feat" environment
```

Each server receives `PORT`, `VITULINA_ENV`, and `VITULINA_PROXY_PORT` as environment variables.

Without `--detach`, logs stream to the console and the process stays in the foreground. With `--detach` / `-d`, servers run in the background.

### `vitulina down [server...]`

Stop running servers.

```sh
vitulina down                # stop servers listed in .vitulina.yaml
vitulina down api            # stop only "api"
vitulina down --env feat     # stop servers in the "feat" environment
vitulina down -A             # stop all servers for current project/env
vitulina down --project foo  # stop all servers in project "foo" (all envs)
vitulina down -a             # stop every server across all projects/envs
```

### `vitulina logs [server...]`

View server logs.

```sh
vitulina logs                # print logs for servers in .vitulina.yaml
vitulina logs -f             # tail logs in real-time
vitulina logs api            # logs for a specific server
vitulina logs -A             # logs for all servers in current project/env
vitulina logs --project foo  # logs for all servers in project "foo"
vitulina logs -a             # logs for every server across all projects/envs
```

### `vitulina ps [server...]`

List running dev servers.

```sh
vitulina ps                  # servers listed in .vitulina.yaml
vitulina ps -A               # all servers for current project/env
vitulina ps --project foo    # all servers in project "foo" (all envs)
vitulina ps -a               # every server across all projects/envs
vitulina ps --env feat       # servers in the "feat" environment
```

### `vitulina proxy start|stop|logs`

Manage the reverse proxy (port 4000).

```sh
vitulina proxy start     # start the proxy
vitulina proxy stop      # stop the proxy
vitulina proxy logs      # view proxy logs
vitulina proxy logs -f   # tail proxy logs
```

The proxy is started automatically when you run `vitulina up`. Requests that don't match a local server are forwarded to the configured `upstream_proxy_domain`.

## Connecting to the proxy

There are two ways to route traffic through the vitulina proxy: using the PAC file for automatic routing, or manually targeting port 4000 (`VITULINA_PROXY_PORT`).

### Using the PAC file

The proxy serves a [PAC (Proxy Auto-Configuration)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file) file at:

```
http://localhost:4000/proxy.pac
```

The PAC file tells your browser or system which requests should go through the vitulina proxy based on hostname. Only requests matching your configured `domain_suffix` patterns are proxied — everything else goes direct.

#### Browser setup

**macOS (system-wide):** Go to System Settings > Network > your network adapter > Proxies, enable "Automatic Proxy Configuration", and set the URL to `http://localhost:4000/proxy.pac`.

**Firefox:** Go to Settings > Network Settings > Settings, select "Automatic proxy configuration URL", and enter `http://localhost:4000/proxy.pac`.

> **Firefox and localhost:** By default, Firefox does not send `localhost` requests through a proxy. Since your dev server hostnames resolve to localhost, you need to change this. Go to `about:config` and set `network.proxy.allow_hijacking_localhost` to `true`.

#### Terminal setup

Most CLI tools (curl, wget, etc.) respect the `http_proxy` / `HTTP_PROXY` environment variable but do not support PAC files natively. To use the proxy from the terminal, set the proxy environment variables:

```sh
export http_proxy=http://localhost:4000
export HTTP_PROXY=http://localhost:4000
```

This sends all HTTP traffic through the proxy. If you only want to proxy specific domains, use the `no_proxy` / `NO_PROXY` variable to exclude everything else.

### Alternative: using port 4000 directly

Instead of configuring a PAC file or proxy environment variables, you can send requests directly to `http://localhost:4000` with the appropriate `Host` header. The proxy uses the `Host` header to determine which server to route to:

```sh
curl -H "Host: api.default.myproject.localhost" http://localhost:4000/some/endpoint
```

This is useful for quick testing or in environments where configuring a proxy is inconvenient.

If you use `*.localhost` domains (recommended), then you can also use the command below given all localhost domains resolve to localhost anyway.

```sh
curl api.default.myproject.localhost:4000/some/endpoint
```

## Server targeting

`ps`, `down`, and `logs` share the same targeting flags to control which servers they operate on.

By default (no flags), these commands read the nearest `.vitulina.yaml` to determine the project and server list, and use the current jj workspace as the environment. Positional server arguments always override the default server list.

| Flag                   | Effect                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| _(none)_               | Current project, current env, servers from `.vitulina.yaml`                                     |
| `--env`                | Override the environment (project and server list still from config)                            |
| `--all-servers` / `-A` | Remove the config server-list filter (show all registered servers for the current project/env)  |
| `--project` / `-p`     | Target a specific project — skips config, shows all envs and all servers                        |
| `--all` / `-a`         | Everything: all projects, all envs, all servers. Ignores all other flags except positional args |

`--project` implies `-A`. A `.vitulina.yaml` is required unless `--all` or `--project` is passed.

## Environments

The `--env` flag isolates servers into named environments. By default, vitulina uses the current [jj](https://jj-vcs.github.io/jj/) workspace name as the environment. If you're not in a jj workspace, the environment defaults to `"default"`.

This lets you run the same project's servers in parallel across different environments — each gets its own hostnames and ports.

## Development

Requires [Bun](https://bun.sh) and [pnpm](https://pnpm.io).

```sh
pnpm install             # install dependencies
pnpm run dev             # run CLI via bun (development)
pnpm run build           # compile with tsgo
pnpm run types           # type-check only
pnpm run lint            # lint with oxlint
pnpm run format          # format with oxfmt
pnpm run ci              # types + lint + format check
```
