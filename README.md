# Linux Virtualization & Container Management Platform

A browser-based platform for provisioning, accessing, and monitoring isolated Linux
containers on demand — rebuilt on a **Node.js / Express** control plane (replacing
FastAPI) talking to the Docker Engine via the **Dockerode** SDK, with a
**React + TypeScript** frontend, **WebSocket**-streamed terminal (`docker exec`)
and live resource stats, JWT auth, per-user quotas, and a set of platform features
layered on top of the original design.

## Stack

```
Browser (React/TS, xterm.js, recharts)
   │  REST (JWT)                 │ WebSocket (exec/stats)
   ▼                              ▼
Node.js + Express control plane  (server.js)
   │  dockerode (Docker Engine API)
   ▼
Docker Engine  →  isolated Linux containers (per-user network, volumes, cgroup limits)
   │
   └─ WSL2 → Ubuntu 24.04 → Docker Desktop → Docker Engine  (Windows host chain, unchanged)
```

## Features

**Core (from the original design, ported to Node.js)**
- Container lifecycle management (create/start/stop/restart/delete) via the Docker SDK (Dockerode)
- Configurable CPU/memory limits and process isolation (`NanoCpus`, `Memory`, `PidsLimit`, dropped capabilities, `no-new-privileges`)
- Persistent named volumes per container (`/workspace` survives stop/restart)
- WebSocket-streamed `docker exec` TTY terminal (raw stdin/stdout bridge, resize support)
- Real-time monitoring of CPU, memory, network I/O, uptime, and health over WebSocket (tapped from Docker's native stats stream, not polled)

**Added on top**
- **Auth & multi-tenancy** — JWT-based auth, bcrypt password hashing, first registered user auto-promoted to admin, per-user container ownership checks on every route and WS connection
- **Per-user quotas** — max containers, CPU limit, memory limit, enforced server-side on create; adjustable per-user from the Admin panel
- **Environment templates** — seeded blueprints (Ubuntu bare, Python/Jupyter data science, Node dev box, browser VS Code) with admin-manageable custom templates
- **Isolated networking** — all sandboxes run on a dedicated Docker bridge network, separate from the host and each other
- **Dynamic subdomain routing** — containers with an exposed port (e.g. Jupyter, code-server) get a generated Nginx vhost (`<name>.<BASE_DOMAIN>`) proxying to their randomly assigned host port
- **Idle auto-shutdown** — background reaper stops containers with no exec/stat activity for `IDLE_TIMEOUT_MINUTES`, preserving their volume so they can be restarted later
- **Snapshots** — commit a running container's filesystem to a reusable image (`POST /containers/:id/snapshot`)
- **File management** — browser file explorer (`FileManager.tsx`) for the container's `/workspace` volume: browse, create folders, upload, download, delete, backed by `container.getArchive`/`putArchive` over the Docker API
- **Audit logging & session recording** — every lifecycle action, login, and exec session is logged with user/target/timestamp; keystrokes in exec sessions are recorded (buffered, periodically flushed) for later review
- **Resource alerting** — CPU/memory threshold breaches raise an alert (stored + optional outbound webhook), surfaced in the Admin panel
- **Multi-host orchestration (lightweight)** — the control plane can talk to more than one Docker Engine (`hosts` table); new sandboxes are scheduled onto whichever enabled host has the fewest running containers (`hostPool.js`). Admins add hosts from the Admin panel. This is a scheduling layer, not a replacement for Swarm/k3s — see "further scaling" below for how to swap it out
- **Security hardening options** — optional gVisor/Kata runtime (`SANDBOX_RUNTIME=runsc`), custom seccomp/AppArmor profiles, plus the always-on baseline (dropped capabilities, `no-new-privileges`, PID limits)
- **CI/CD integration** — `POST /api/ci/run`, protected by a static API key, spins up a throwaway container, runs a command to completion, and returns exit code + logs — a drop-in step for GitHub Actions or similar pipelines
- **Metrics history + Prometheus/Grafana** — stats samples are persisted to `metrics_history` (~every 10s) and surfaced as a "History" toggle on the live chart; a standard `/metrics` endpoint exposes Prometheus-format gauges for Grafana or any Prometheus-compatible scraper
- **Public demo mode** — `POST /api/demo/start` creates a rate-limited, heavily-capped, auto-expiring guest account + sandbox (no signup) for portfolio visitors to try live; a "Try live demo" button on the login screen
- **Online compiler** — `/compiler` in the UI: pick a language, write code, hit Run. Backed by `POST /api/compiler/run`, which spins up a fresh, **network-disabled**, resource-capped container per submission (same Dockerode primitives as everything else), injects the source via `putArchive`, execs the build/run command with a hard wall-clock timeout (kills the container on overrun — no infinite-loop DoS), and tears the container down immediately after. Supports Python, JavaScript, TypeScript (via Deno, no npm install needed), Java, C, C++, Go, Rust, Ruby, PHP, C# (via Mono), and Bash. Per-user rate limited (`COMPILER_RUNS_PER_HOUR`)
- **Admin panel** — user list with live-editable quotas, Docker host management, platform-wide audit log, alert feed, active-container overview
- **Rate limiting** — login/register/demo endpoints are rate-limited against abuse
- **Theming & terminal polish** — light/dark theme toggle (persisted), split-pane terminal (two independent exec sessions side by side)
- **Dockerized deployment** — `docker-compose.yml` for backend, frontend, and an Nginx reverse proxy that serves both the app and the dynamic sandbox subdomains

## Further scaling (deliberately left as an integration point, not built in)

- **Real multi-host scheduling** — swap `hostPool.pickHost()` for a Docker Swarm or k3s API call to get proper bin-packing, health-aware failover, and rolling updates across a large fleet; every other module only depends on `getClientForHost()`/`pickHost()`, so that's the one seam to change
- **Metrics dashboards** — point an actual Prometheus server at `/metrics` and layer Grafana on top for retention/alerting beyond what the built-in history table and webhook alerts cover
- **gVisor/Kata in production** — the runtime toggle is there; actually installing/registering `runsc` or `kata-runtime` with the Docker daemon is host-level setup outside this repo

## Running locally (without Docker Compose)

```bash
# Backend
cd backend
cp .env.example .env      # edit JWT_SECRET etc.
npm install
npm run dev                # requires Docker Engine reachable at DOCKER_SOCKET

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173, proxies /api and /ws to :4000
```

## Running with Docker Compose

```bash
docker network create platform_sandbox_net   # backend also creates this on boot, but compose needs it to exist first
docker compose up --build
```

- App: http://localhost:5173
- API: http://localhost:4000
- Sandbox previews: `http://<name>-<id>.sandboxes.local` (point that domain/wildcard DNS at the proxy host, or add entries to `/etc/hosts` for local testing)

## API summary

| Method | Path | Description |
|---|---|---|
| POST | /api/auth/register | Create account (first user becomes admin) |
| POST | /api/auth/login | Get JWT |
| POST | /api/demo/start | Public demo mode: instant guest account + sandbox, auto-expires |
| GET | /api/templates | List environment blueprints |
| GET | /api/containers | List your containers |
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
| GET/POST/PATCH | /api/admin/... | Admin: users, quotas, Docker hosts, audit, alerts, overview |
| GET | /metrics | Prometheus-format scrape endpoint |
| WS | /ws/exec/:id?token=JWT | Interactive terminal |
| WS | /ws/stats/:id?token=JWT | Live CPU/mem/net stream |

## Security notes

This is a portfolio/demo-grade platform. Before exposing it beyond a trusted network:
switch container runtime isolation to gVisor/Kata, put the API behind TLS, restrict
the Docker socket mount (or use a Docker socket proxy with scoped permissions),
and review the capability allow-list in `dockerService.js`.
