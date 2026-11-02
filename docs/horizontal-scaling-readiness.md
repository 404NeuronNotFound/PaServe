# Horizontal scaling readiness (Phase 27)

**2 November update:** The single-auth-owner restriction below applies to
`SECURITY_STATE_MODE=local`. An opt-in Postgres mode now shares route budgets,
authentication risk and replay reservations across instances. Vercel requires
that mode. See [Vercel preparation](../deployment/vercel-api.md) for the migration,
remaining local resource limits, branch workflow and validation requirements.
The historical multi-origin evidence below was collected in local mode.

Business API requests can run on multiple NestJS instances sharing the same
PostgreSQL/Supabase project and JWT configuration. The portable edge now supports
one to eight business origins with least-connections balancing. Authentication
must stay on one explicitly designated API while abuse/challenge state remains
process-local. This is a constrained scaling topology, not highly available or
horizontally distributed authentication.

## State inventory

| State | Authority and scaling rule |
| --- | --- |
| Sessions, users, memberships | PostgreSQL via live repository queries. All instances share the same distinct access/refresh JWT secrets, issuer/audiences, cookie/origin settings and database. No business-session affinity is required. Revocation and membership changes remain live. |
| Orders, payments, idempotency | Database transactions, conditional writes and unique indexes remain authoritative across instances. Preserve case-insensitive request/payment-key indexes and receipt immutability. Retry with the same key only after checking outcome. |
| Media | Supabase Storage; API memory holds bounded upload buffers, not persistent files. All instances need the same server-side project configuration. |
| Public catalog cache | Per-instance bounded disposable cache. Shared SQL catalog versions/triggers invalidate both instances; live shop/access checks still run. Cold/replaced nodes read from PostgreSQL. |
| Realtime/SSE | Supabase broadcasts bridge instances. Each API owns only its local listeners/subscriptions and streams. Reconnect/resync is required after node loss; no in-process event bus is the cross-instance authority. See the existing fan-out evidence. |
| Login abuse, bot risk, token replay | Process-local account/IP state and challenge token reservations. Every `/api/v1/auth` route goes to one designated owner; do not distribute these paths or automatically fail them over. Provider verification remains mandatory. |
| API admission, hashing, menu gates, fairness | Local resource protection, intentionally per process. Global IP budgets at the single edge supplement backend limits. Backend per-shop/account budgets are not strict fleet-wide quotas; total capacity can multiply with replicas. |
| Metrics, request IDs | Per-process counters/UUIDs. Aggregate route histogram counts with instance IDs and reset-aware intervals; do not average instance percentiles. External timing counters are process-local too. |

Request-local maps used to assemble bounded query results are not shared business
state. No new Redis, distributed lock, database throttle writes or migration is
introduced by this topology.

## Portable edge configuration

Single-origin `--upstream` remains supported. For multiple origins, repeat
`--api-upstream` and specify exactly one `--auth-upstream`. The renderer rejects
an empty, duplicate, oversized or unsafe list, mixed legacy/list options, and a
multi-origin configuration without an explicit auth owner.

```powershell
pnpm edge:render --hostname api.example.test --api-upstream 10.0.0.11:3000 --api-upstream 10.0.0.12:3000 --auth-upstream 10.0.0.11:3000 --prefix /var/lib/paserve-edge --certificate /etc/paserve/fullchain.pem --certificate-key /etc/paserve/key.pem --frontend-origin https://app.example.test --output artifacts/edge/nginx.conf
```

Addresses and certificates above are placeholders for the operator's private
deployment. This command only renders a reviewable file. Run `nginx -t` on the
actual host before activation. No configuration is deployed automatically.
The auth owner can also be a dedicated third Nest process; include it in all
connection, CPU and memory budgets. Changing its address is not a harmless
business-node replacement: its local abuse history must not be silently split
across old/new owners during a rolling deployment.

All auth paths, including session/logout/profile and future reset routes, use
the auth origin; the existing sensitive login/register/refresh body/concurrency
limits remain. Business routes, uploads and SSE use the business pool. No
client-controlled cookie/header selects an upstream or workload group. There is
no session-affinity cookie. `proxy_next_upstream off` remains in force, so an
uncertain write is never automatically replayed against another API.

The existing shared NGINX zones enforce source-IP limits across workers on this
one edge host. They are not shared across independent edge hosts. Keep backend
guards enabled, replace forwarding headers at the trusted edge, configure exact
trusted proxy CIDRs and prevent direct public access to **every** API port.
Without origin isolation the routing contract can be bypassed.

An unavailable origin can produce an initial 502. NGINX's passive failure handling
can route later business requests to a remaining node; this is not an active
health-check or zero-error failover guarantee. Losing the auth owner returns
502 for auth instead of routing it to fresh per-process risk state. Already
authenticated business traffic can continue on surviving business nodes.

## Budgets and operation

Set `DB_POOL_MAX_PROCESSES` and `DB_POOL_CONNECTION_BUDGET` consistently on all
APIs. The existing policy rejects `DB_POOL_MAX * DB_POOL_MAX_PROCESSES` above
the declared API connection budget. Count auth, all business processes, rolling
surge and any multi-worker process manager in that maximum. Reserve provider
connections separately for migrations, monitoring and administration. Every
process owns one reusable pool and never selects `DIRECT_DATABASE_URL` at runtime.
Use the provider's supported pooled runtime connection; additional replicas do
not create additional PostgreSQL capacity.

Share secrets/configuration through the deployment's secret manager, apply
migrations once through a release job, and run compatible old/new schema versions
during rollout. Do not have every replica seed data or run migrations. Keep
JWT key changes coordinated; no new key-rotation protocol is supplied here.

Probe each private instance's readiness (`/api/v1/health`, includes PostgreSQL)
and liveness (`/api/v1/health/live`, dependency-free). Remove a business instance
from routing before shutdown, allow in-flight writes to settle, and expect SSE
clients to reconnect and resync. Existing Nest shutdown hooks are enabled in
the real bootstrap; orchestrator drain windows/readiness removal still require
deployment verification. Keep the auth owner stable during ordinary business
scale-out/down. Do not add a second auth origin as a workaround for availability.

Use per-instance CPU/event-loop/admission/pool metrics and database waits/CPU to
decide when to scale. Adding APIs to a saturated database can make latency worse.
Existing single-instance capacity/headroom results are environment-specific;
do not multiply them by replica count to claim fleet capacity. Stage ramp,
spike, idempotency and realtime tests against the complete topology.

## Verification and remaining scope

```powershell
pnpm test:edge
pnpm --filter api exec vitest run --config vitest.config.e2e.ts test/horizontal-scaling.e2e-spec.ts --maxWorkers=2
pnpm --filter api test:pooling:postgres
pnpm --filter api test:caching:postgres
```

Native NGINX tests use two disposable loopback HTTP origins. They check both
business destinations, auth affinity for all paths, auth-owner failure without
automatic failover, preserved SSE/uploads/security filtering, and shared edge
flood limits. They do not start real Nest origins. Separate two-Nest HTTP tests
use real JWT verification/guards and a shared repository fixture to check token
portability, live membership/revocation and replacing an instance. These tests
do not claim actual PostgreSQL session replication; production already uses one
shared PostgreSQL authority. Existing disposable real-PostgreSQL tests separately
cover multi-pool bounds and cache invalidation across independent cache instances.
The old cache coalescing fixture now holds four admitted callers, matching the
production menu gate, rather than waiting for eight callers that cannot all be
admitted simultaneously. Production admission limits were not changed.

Local constrained business scaling is supported. Multiple authentication
replicas require a separately designed shared rate/account-risk/replay store
or equivalent verified central enforcement. Strict fleet-wide tenant quotas
also require shared coordination. Auth high availability, multiple independent
edges, hosted load-balancer health/drain behavior, secret/config parity, origin
firewall enforcement and measured hosted fleet capacity remain incomplete.
This phase does not claim unrestricted multi-instance deployment readiness.
