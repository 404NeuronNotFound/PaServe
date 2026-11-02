# PaServe release path

Current audit: [2 November 2026 readiness report](../docs/deployment-readiness-2026-11-02.md).
**Do not deploy the current environment unchanged.** Supabase supplies the project's
PostgreSQL, Auth and Storage; this repository also runs a NestJS business API.
No public host for that Node process has been identified. Both frontend and API
can use Vercel; see [Vercel API and production-branch setup](vercel-api.md).
This guide prepares configuration; it does not activate a deployment.

## 1. Prepare the NestJS API host

Use the tested Node **24.x** and the repository's pinned pnpm. Build from the
repository root so the workspace contracts are included:

```sh
pnpm install --frozen-lockfile
pnpm --filter api build
pnpm --filter api start:prod
```

The API build generates the Prisma client, builds contracts, and compiles to
`apps/api/dist`; start uses `dist/main.js`. Keep the workspace dependency links
and runtime packages in the deployment image. Do not upload only `dist/main.js`.
Build tools/dev dependencies are needed during the build; runtime still needs
its production dependencies, generated Prisma output and built contracts.

Configure the host from `apps/api/.env.example`:

- `NODE_ENV=production` and the host's `PORT`. Bind appropriately for the host's
  network. Do not expose an unprotected direct origin around a required edge.
- `DATABASE_URL`: the supported Supabase runtime connection with verified TLS.
  Download the project's trusted CA from Supabase and configure the driver/host
  trust correctly. The current certificate-verified probe failed; do not work
  around it using disabled certificate verification. `NODE_EXTRA_CA_CERTS`, if
  used, must be set by the host before Node starts, not only through dotenv.
- `DIRECT_DATABASE_URL`: separate administrative direct/session connection for
  the single migration job where needed. The application never selects it.
- Distinct strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, each at least
  32 characters. Share them across instances and keep them server-only.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; optionally the public
  `SUPABASE_ANON_KEY` for identity calls. No privileged key belongs in Vercel's
  frontend `VITE_` variables or generated browser assets.
- `FRONTEND_ORIGINS`: exact deployed HTTPS frontend origin(s). No localhost,
  paths or wildcard origins. This controls both CORS and cookie-auth checks.
- Production bot protection defaults on: provide `TURNSTILE_SECRET_KEY` and
  `TURNSTILE_HOSTNAMES`, with the matching frontend widget site key. An intentional
  change to that policy must be explicit; do not discover missing keys on launch.
- Exact `TRUSTED_PROXY_CIDRS` for the real proxy chain; do not trust every source.
  Confirm client IP handling on the selected host. Set connection/process budgets
  and caps for the selected resources, counting rolling-deployment overlap.

In local security mode, start with one API process unless the auth-owner/edge
topology in [horizontal scaling](../docs/horizontal-scaling-readiness.md) is
deliberately configured. Vercel requires the shared Postgres mode described in
[the API guide](vercel-api.md); local CPU/admission budgets remain per process.

## 2. Apply reviewed migrations once

Six migrations were pending in the checked Supabase database. The Vercel
follow-up adds `20261102020000_shared_security_state`; include it in release
review as well. See the report and recheck status before migrating.
Back up and confirm restoration, review the target and existing-data preflight,
then apply through a single release job before starting the updated API:

```sh
pnpm --filter api db:status
pnpm --filter api db:deploy
pnpm --filter api db:status
```

The commands above are operator release steps, **not actions performed by the
audit**. `db:deploy` applies all pending migrations. It is not a per-instance
startup command. Unique index creation and constraint validation can lock or fail;
plan the rollout and maintenance window for actual data volume. Do not rewrite
paid orders or bypass constraints to force a successful migration.

The aggregate preflight can be rerun from `apps/api`:

```sh
node scripts/deployment-preflight.mjs
```

It uses an explicit read-only transaction and prints only counts/schema/TLS flags.
It is not proof that every possible drift, lock or operational issue is absent.

## 3. Prepare Vercel at the repository root

Keep the browser API at `/api/v1` and proxy it to the deployed NestJS API. This
preserves the same browser origin for guest tracking cookies, which are Strict.
Do not point `VITE_API_URL` at the Supabase project URL: it does not expose these
NestJS routes. Vite's development proxy is not a production Vercel proxy.

Create an untracked frontend production environment using `apps/web/.env.example`:

```dotenv
VITE_API_URL=/api/v1
VITE_PUBLIC_APP_URL=https://YOUR-FRONTEND-DOMAIN
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLIC-ANON-KEY
VITE_TURNSTILE_SITE_KEY=YOUR-PUBLIC-WIDGET-SITE-KEY
CSP_REPORT_ONLY=false
```

Use real values. Google remains hidden until its public client ID is configured;
enable/configure the Google provider in Supabase and Google first. Email-only
launch is possible if the Google feature remains hidden.

Use the **same** nonsecret frontend environment to generate the configuration and
build the frontend. With Node 24, from the repository root:

```sh
node --env-file=apps/web/.env.production scripts/prepare-vercel.mjs --api-origin https://YOUR-NEST-API-HOST --output vercel.json
pnpm --filter web build
pnpm --filter web test:security-release
pnpm test:leaks
```

The renderer emits Vercel header rules from the existing CSP/header policy, an API
rewrite before SPA fallback, and the monorepo install/build/output settings. It
rejects loopback origins, credentials, paths, mismatched API build config and
report-only CSP. Review the generated `vercel.json` and configure the same values
in Vercel's production environment. Keep the Vercel project root at the repository
root, using `apps/web/dist` as output. The `_headers` file alone does not configure
Vercel headers. The renderer is locally tested; verify it on a Vercel preview.

The API host must allow the exact frontend origin and the selected routing must
support SSE, uploads, cookies and timeouts. Verify those on the actual deployment;
configuration generation does not prove remote proxy behavior.

## 4. Release verification and smoke checks

Run `pnpm verify` with the actual production environment after prerequisites are
resolved. The current localhost environment intentionally fails the release build.
Never deploy a `build:local` artifact. Audit-generated example/proof artifacts are
not a substitute for the final host-specific release build.

On staging/preview and then the deployed HTTPS host, verify:

1. `/api/v1/health/live` (liveness) and `/api/v1/health` (database readiness).
   Readiness queries `SELECT 1`; it does not certify schema migration status.
2. Registration OTP, email verification, login, refresh, logout, recovery and
   email change. Check saved Supabase email templates use the right token fields
   and that Brevo actually delivers. The audit sent no emails.
3. Owner/Admin/Manager/Cashier/Kitchen access and cross-shop denials; catalog and
   logo/banner/product uploads; menu cache invalidation.
4. Public pickup QR and table QR on a phone; order/quote, counter payment,
   preparation and completion; private tracking after reload and SSE reconnect.
5. Actual Vercel/API headers, CORS and cookies, CSP console/network behavior,
   direct route reloads and missing assets. Google popups only if enabled.
6. Backups, restore procedure, logs/alerts, health monitoring, process draining,
   and representative sustained traffic against staging. No production load test
   or deployment was performed in this audit.

## Primary platform references

- [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Supabase connections and CA configuration](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)
