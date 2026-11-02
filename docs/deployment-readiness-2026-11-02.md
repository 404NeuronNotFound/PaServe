# Deployment readiness — 2 November 2026

**Decision: HOLD public deployment of the current environment.** The patched
application passes the local regression suites, but the configured database is
missing required schema and the production hosting/environment is incomplete.
This report is an audit and preparation result, not approval to migrate or deploy.

Follow-up implementation: [Vercel API preparation](../deployment/vercel-api.md)
adds shared Postgres security state, managed ingress handling, bounded invocation
lifetimes and 4 MiB uploads. It adds one further migration,
`20261102020000_shared_security_state`, beyond the six observed pending below.
Those live blockers remain unresolved; no live migration or deployment was run.

## Confirmed release blockers

| Finding | Evidence and required action |
| --- | --- |
| NestJS API host not identified | The user confirmed Supabase is live and Vercel is planned for the frontend. Supabase DB/Auth/Storage do not establish that `apps/api/src/main.ts` is running on a public host. No host URL or runtime deployment for that Nest process was supplied/found. Deploy the API and establish its HTTPS health endpoint before pointing Vercel at it. |
| Six unapplied migrations | Read-only Prisma status found 67 migration directories, with the six below pending. The cache table and all four policy metadata columns are actually absent. Current catalog/account code relies on them. Review backups/restore and apply once through a controlled release job; no migration was applied by this audit. |
| Database TLS not ready | The configured connection reported `clientTls: false`. A process-only `sslmode=verify-full` test failed with `SELF_SIGNED_CERT_IN_CHAIN`. Obtain/configure the trusted project CA and verify TLS on the selected host. No certificate verification was disabled and no stored connection string was changed. |
| Frontend production URL/routing not configured | The actual release build fails because local `VITE_API_URL` points at loopback. A process-only `/api/v1` build and release-policy check pass. This proves build/policy compatibility, not that a remote proxy exists. Configure the real API host and Vercel rewrite, exact frontend origins, and HTTPS. |
| Production startup settings incomplete | Local configuration is not production, includes local/development origins, and has no Turnstile secret/hostnames or frontend widget key. Production defaults require that configuration. Proxy trust and database connection/process budgets have not been declared for a host. Populate the host's secrets/settings from the examples and review capacity; do not copy the local environment unchanged. |
| Deployed-host acceptance not performed | No actual Vercel/API staging host, browser journey, physical QR/print test, SMTP delivery, backup restoration or production-capacity check was performed. Run these after configuration/migrations, before public launch. |

Pending migrations, in order:

1. `20261019000000_validation_hardening`
2. `20261028090000_idempotency_key_identity`
3. `20261028100000_tenant_query_indexes`
4. `20261029090000_collection_paging_indexes`
5. `20261029100000_public_menu_cache_versions`
6. `20261102010000_registration_policy`

The enforced read-only preflight returned zero invalid shop/category/product
length/sort rows and zero case-insensitive request/payment identity conflicts.
This does not prove lock-free migration or the absence of all schema drift.
The health readiness endpoint uses `SELECT 1`, so health success alone cannot
detect these missing migrations.

## Fixes and preparation completed

- Patched `qs` to 6.16.1, `follow-redirects` to 1.16.2, and current minimatch 10.x
  consumers to 11.0.1 through explicit overrides and an updated lockfile. The
  initial scan found one high and two moderate advisories; the final registry
  scan reports **zero** across runtime and development dependencies. The major
  minimatch change was followed by complete application tests and builds.
- Updated stale HTTP assertions for the safe `signInMethod` profile field and
  explicit abuse policies on both implemented recovery endpoints. The assertions
  remain exact; recovery is required to use the registration abuse budget.
- Made API builds explicitly generate the untracked Prisma client before Nest
  compilation, added `db:generate`, `db:status`, `db:deploy`, and made the production
  entry point explicit as `dist/main.js`. The release verifier generates Prisma
  before type-aware lint/tests and includes Vercel preparation tests.
- Declared tested Node 24.x in the root package and retained pinned pnpm 12.9.1.
- Added `scripts/prepare-vercel.mjs`: produces actual Vercel headers from the
  shared security policy, a same-origin API proxy before SPA fallback, and the
  repository-root monorepo build/output settings. It needs the actual API host
  and the same frontend environment used by the release build. No root
  `vercel.json` with guessed hostnames was activated.
- Added `apps/api/scripts/deployment-preflight.mjs`, which enforces a read-only
  transaction and reports only aggregate migration-conflict, schema and TLS flags.
- Documented the complete deployment order, secrets separation, CA setup, routing,
  provider configuration and host smoke checks in [deployment/README.md](../deployment/README.md).

## Verification after dependency patches

| Check | Result | Scope |
| --- | --- | --- |
| API unit suite | **1,529 passed, 92 files** | Local service/security behavior |
| API HTTP suite | **2,219 passed, 52 files** | Auth, recovery, tenant access, validation, catalog, orders, payments, reports, rate limits, streams and failure behavior; many fixtures mock storage/services |
| Frontend full suite | **2,383 passed, 175 files** | User flows, state, QR generation, role presentation and component behavior |
| Main suite total | **6,131 passed** | Not an end-to-end deployed production certification |
| API and frontend lint | Passed | Type-aware API and frontend/shared-control conventions |
| API build | Passed | Includes fresh Prisma generation and compiled production entry |
| Actual frontend environment release build | **Blocked, intentionally** | Correctly rejects localhost API config |
| Release configuration proof | Passed | Process-only `VITE_API_URL=/api/v1`, enforced CSP; original environment files unchanged |
| Release security-policy acceptance | Passed | Generated HTML/assets/host artifacts and local preview/dev behavior; not Vercel header installation |
| Isolated compiled API bootstrap | Passed | Dummy unavailable loopback DB, no real provider calls: root/liveness 200, readiness 503, no-store/nosniff present; process stopped afterward |
| Vercel configuration tests | **9 passed** | Header emission, proxy ordering, URL/loopback rejection and required build alignment |
| Edge configuration validation | **5 passed** | Renderer policy, not an activated remote edge |
| Metric/recovery/monitor/fixture-safety/acceptance suites | Passed | Report calculations and safe harness behavior; no actual load traffic generated |
| Dependency registry audit | **0 known advisories** | Current lockfile; not proof of absence of undisclosed vulnerabilities |
| Targeted secret exposure scan | Passed | Current sources and 15 built frontend text files; not a Git-history audit |
| Database checks | Read-only, aggregate only | No business data or schema was modified |

Source inspection inventoried **131 statically declared routes across 36
controllers**, including the order controller declared in a module file. The
inventory includes decorator/policy metadata and is saved in the evidence folder.
It is not a scan of a deployed API or a claim that tests exercise every possible
state/path. No unresolved dynamic route declarations were found by that inventory.

## Provider and infrastructure observations

The read-only Supabase Auth settings request returned email enabled, signup
enabled, email auto-confirm disabled, and **Google disabled**. The local frontend
has no Google client ID, so its Google button is hidden. Google is not launch-ready
if it is advertised; keep an intentional email-only launch or configure both
Supabase Google and the OAuth client/origins before exposing the option.

Brevo SMTP delivery and saved Supabase templates were not tested/inspected in
this audit. No real verification, reset or notification email was sent. Test
registration, recovery and both-inbox email change on staging with designated
accounts after configuration is complete.

API rate/challenge state is process-local. The existing documented multi-node
design requires one explicit auth owner and controlled edge routing. Do not
assume adding replicas, public origin bypass, automatic failover or serverless
instances preserves those controls. Pool budgets, proxy/IP behavior, upload/SSE
limits, monitoring and host capacity must be checked on the selected platform.

The main frontend JS chunk remains approximately **1.08 MB / 302 KB gzip**.
This is a performance observation, not a failing security/build check; measure
real device startup and split further where evidence supports it.

## Evidence and next steps

Machine-readable evidence: [artifacts/deployment-audit/2026-11-02](../artifacts/deployment-audit/2026-11-02).
It contains before/after advisory reports, aggregate database preflight, failed TLS
probe metadata, provider flags, route inventory and isolated bootstrap results.
No secrets, user rows or credential-bearing URLs are intentionally included.

Follow [the release guide](../deployment/README.md): choose/confirm the API host,
resolve verified TLS, back up and migrate, configure exact production settings,
generate/review Vercel configuration, then run the final production verifier and
staging/host smoke checks. `pnpm verify` has not been represented as passing with
the current environment: its actual production build gate still correctly fails.

No database migration, remote configuration change, email, production/staging capacity run, publication,
commit, or production deployment was performed by this audit.

Primary advisory references:
[qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw),
[follow-redirects](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p),
[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).
