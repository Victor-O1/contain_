# SANDBOX::CTRL — Local Container Sandbox Platform (Node.js)

A local, single-user, browser-based platform for provisioning, accessing, and monitoring
isolated Linux containers on demand — **Node.js / Express** control plane talking to the
Docker Engine via **Dockerode**, a **React + TypeScript** frontend styled as a terminal/hacker
control panel, **WebSocket**-streamed exec terminal and live resource stats, plus an
in-browser **online compiler** for 12 languages.

**No login, no signup.** This runs as a single local operator account, auto-created on
first boot — there's nothing to sign into. If you need multi-user auth back (e.g. to expose
this beyond your own machine), see "Adding auth back" at the bottom.

## Running it (Windows / Docker Desktop)

The error you're likely here because of:

```
error during connect: Head "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/_ping":
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

means **Docker Desktop isn't running**. Fix:

1. Launch **Docker Desktop** from the Start menu and wait for the whale icon in the system
   tray to stop animating — that means the engine has finished starting.
2. If Docker Desktop won't start: open it → **Settings → General** → confirm **"Use the
   WSL 2 based engine"** is checked → restart Docker Desktop.
3. Confirm it's up: `docker info` should print engine details, not an error.
4. Then continue below.

### Backend

```powershell
cd backend
copy .env.example .env
npm install
npm run dev
```

Runs on `http://localhost:4000`. On first boot it auto-creates the SQLite DB, seeds the
default templates, the local Docker host entry, and the single local operator account —
no setup step required.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` — you land straight on the dashboard, no login screen.

### Docker Compose (optional, runs everything containerized)

```powershell
docker network create platform_sandbox_net
docker compose up --build
```

## Stack

```
Browser (React/TS, geek terminal UI, xterm.js, recharts)
   │  REST                        │ WebSocket (exec/stats)
   ▼                              ▼
Node.js + Express control plane  (server.js)
   │  dockerode (Docker Engine API)
   ▼
Docker Engine  →  isolated Linux containers (per-sandbox network, volumes, cgroup limits)
```

## Features

**Core (from the original design, ported to Node.js)**
- Container lifecycle management (create/start/stop/restart/delete) via the Docker SDK (Dockerode)
- Configurable CPU/memory limits and process isolation (`NanoCpus`, `Memory`, `PidsLimit`, dropped capabilities, `no-new-privileges`)
- Persistent named volumes per container (`/workspace` survives stop/restart)
- WebSocket-streamed `docker exec` TTY terminal (raw stdin/stdout bridge, resize support)
- Real-time monitoring of CPU, memory, network I/O, uptime, and health over WebSocket (tapped from Docker's native stats stream, not polled)

**Added on top**
- **No auth** — single local operator account, auto-created on boot. No login/signup screens, no tokens. Every route just works. See "Adding auth back" if you need multi-user access control later
- **Environment templates** — seeded blueprints (Ubuntu bare, Python/Jupyter data science, Node dev box, browser VS Code) with admin-manageable custom templates
- **Isolated networking** — all sandboxes run on a dedicated Docker bridge network, separate from the host and each other
- **Dynamic subdomain routing** — containers with an exposed port (e.g. Jupyter, code-server) get a generated Nginx vhost (`<name>.<BASE_DOMAIN>`) proxying to their randomly assigned host port
- **Idle auto-shutdown** — background reaper stops containers with no exec/stat activity for `IDLE_TIMEOUT_MINUTES`, preserving their volume so they can be restarted later
- **Snapshots** — commit a running container's filesystem to a reusable image (`POST /containers/:id/snapshot`)
- **File management** — browser file explorer (`FileManager.tsx`) for the container's `/workspace` volume: browse, create folders, upload, download, delete, backed by `container.getArchive`/`putArchive` over the Docker API
- **Audit logging & session recording** — every lifecycle action and exec session is logged with target/timestamp; keystrokes in exec sessions are recorded (buffered, periodically flushed) for later review
- **Resource alerting** — CPU/memory threshold breaches raise an alert (stored + optional outbound webhook), surfaced in the Admin panel
- **Multi-host orchestration (lightweight)** — the control plane can talk to more than one Docker Engine (`hosts` table); new sandboxes are scheduled onto whichever enabled host has the fewest running containers (`hostPool.js`). Add hosts from the Admin panel. This is a scheduling layer, not a replacement for Swarm/k3s — see "further scaling" below for how to swap it out
- **Security hardening options** — optional gVisor/Kata runtime (`SANDBOX_RUNTIME=runsc`), custom seccomp/AppArmor profiles, plus the always-on baseline (dropped capabilities, `no-new-privileges`, PID limits)
- **CI/CD integration** — `POST /api/ci/run`, protected by a static API key, spins up a throwaway container, runs a command to completion, and returns exit code + logs — a drop-in step for GitHub Actions or similar pipelines
- **Online compiler** — `/compiler` in the UI: pick a language, write code, hit Run. `POST /api/compiler/run` spins up a fresh, **network-disabled**, resource-capped container per submission, injects the source, execs the build/run command with a hard timeout (kills the container on overrun), and tears it down. Supports Python, JavaScript, TypeScript (Deno), Java, C, C++, Go, Rust, Ruby, PHP, C# (Mono), Bash
- **Metrics history + Prometheus/Grafana** — stats samples are persisted to `metrics_history` (~every 10s) and surfaced as a "History" toggle on the live chart; a standard `/metrics` endpoint exposes Prometheus-format gauges for Grafana or any Prometheus-compatible scraper
- **Admin panel** — Docker host management, platform-wide audit log, alert feed, active-container overview
- **Rate limiting** — compiler runs are rate-limited per session to prevent runaway resource usage
- **Terminal-styled UI** — dark/light "hacker terminal" theme (JetBrains Mono, scanline overlay, terminal-window chrome on every card, `[bracketed]` status badges), split-pane terminal (two independent exec sessions side by side)
- **Dockerized deployment** — `docker-compose.yml` for backend, frontend, and an Nginx reverse proxy that serves both the app and the dynamic sandbox subdomains

## Further scaling (deliberately left as an integration point, not built in)

- **Real multi-host scheduling** — swap `hostPool.pickHost()` for a Docker Swarm or k3s API call to get proper bin-packing, health-aware failover, and rolling updates across a large fleet; every other module only depends on `getClientForHost()`/`pickHost()`, so that's the one seam to change
- **Metrics dashboards** — point an actual Prometheus server at `/metrics` and layer Grafana on top for retention/alerting beyond what the built-in history table and webhook alerts cover
- **gVisor/Kata in production** — the runtime toggle is there; actually installing/registering `runsc` or `kata-runtime` with the Docker daemon is host-level setup outside this repo

## API summary

| Method | Path | Description |
|---|---|---|
| GET | /api/templates | List environment blueprints |
| GET | /api/containers | List sandboxes |
| POST | /api/containers | Launch a sandbox from a template (multi-host scheduled) |
| POST | /api/containers/:id/start\|stop\|restart | Lifecycle control |
| POST | /api/containers/:id/snapshot | Commit container to an image |
| DELETE | /api/containers/:id | Destroy (optional `?keepData=true` to retain volume) |
| GET | /api/containers/:id/stats | One-shot resource stats |
| GET | /api/containers/:id/metrics-history | Historical CPU/mem samples for trend charts |
| GET | /api/containers/:id/audit | Per-container audit trail |
| GET/POST/DELETE | /api/containers/:id/files... | File manager: list, mkdir, upload, download, delete |
| POST | /api/ci/run | CI/CD: run an ephemeral job to completion (API-key protected) |
| GET | /api/compiler/languages | List supported languages + starter snippets |
| POST | /api/compiler/run | Run a code snippet in an isolated container, get stdout/stderr/exit code |
| GET/POST/PATCH | /api/admin/... | Admin: Docker hosts, audit, alerts, overview |
| GET | /metrics | Prometheus-format scrape endpoint |
| WS | /ws/exec/:id | Interactive terminal |
| WS | /ws/stats/:id | Live CPU/mem/net stream |

## Security notes

This runs with **no authentication** by design — it's meant for `localhost` use on your own
machine, same trust model as Docker Desktop itself. Do not expose it directly to the internet
or an untrusted network as-is: anyone who can reach the API can create/delete containers,
read files in any sandbox, and run arbitrary code via the compiler endpoint.

If you need to expose this beyond your own machine, at minimum: put it behind a VPN or
reverse-proxy auth (e.g. an Nginx `auth_basic` in front, or a Tailscale/Cloudflare Access
tunnel), and put the API behind TLS. If you need real per-user accounts and permissions back,
see "Adding auth back" below. Also worth doing for any shared deployment: switch container
runtime isolation to gVisor/Kata, restrict the Docker socket mount (or use a Docker socket
proxy with scoped permissions), and review the capability allow-list in `dockerService.js`.

## Adding auth back

Auth was intentionally stripped for local single-user use. To reinstate it:
1. Re-add a `users` auth flow (JWT or session-based) and a login screen
2. In `authMiddleware.js`, replace the passthrough `requireAuth` with real token verification
3. In `wsRouter.js`, verify a token on the WebSocket upgrade instead of trusting any request
4. In `containers.js`/`files.js`, reinstate per-user `user_id` filtering (the `containers` table
   still has a `user_id` column — it's just always set to `'local'` right now)

Everything else (multi-host scheduling, file manager, compiler, CI runner) is auth-agnostic
and doesn't need to change.
