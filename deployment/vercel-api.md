# Vercel API preparation and branch workflow

Keep `main` for feature work. The `production` branch is the reviewed release
checkpoint in the same repository. Creating/pushing it does not establish that
the live database, production settings or public deployment are ready.
Set **Production Branch = production** in both Vercel projects before connecting
live domains. The API configuration and frontend configuration generator permit
Git deployments only from `production`. This does not prevent an explicit CLI or
dashboard deployment. Use a separate project/database for deliberate previews.

## Two projects from this repository

- Frontend: repository root; generate the reviewed root `vercel.json` using
  `scripts/prepare-vercel.mjs`. Build `web` and keep `VITE_API_URL=/api/v1`.
- API: Root Directory **apps/api**, framework **NestJS**, Node **24.x**.
  Enable inclusion of source files outside the Root Directory, because the build
  uses the workspace contracts. `apps/api/vercel.json` builds contracts, generates
  Prisma and builds Nest. The NestJS preset detects `src/main.ts`; no raw-file
  `functions` override is needed. A `functions.src/main.ts` pattern was rejected
  by Vercel CLI 65.4.0 with `unused_function`. Configure the project's default
  maximum function duration to at least 120 seconds in Vercel settings to cover
  bounded SSE setup/stream cleanup. Do not add an old catch-all `@vercel/node` adapter.
  Keep dev dependencies available during build and retain generated Prisma/native
  Argon2/sharp dependencies in the traced output. Verify the real Vercel build.
- Point the frontend API rewrite at the API project's real stable HTTPS domain.
  Verify cookies, client-IP forwarding and streaming through that exact rewrite.
  Production function invocations must be publicly callable; preview Deployment
  Protection must not silently turn the frontend proxy into an HTML login page.

## API runtime settings

The API package declares Node 24 directly because this project's Root Directory
is `apps/api`. Its `vercel.json` also sets the non-secret runtime flag
`NODE_OPTIONS=--experimental-require-module`. Vercel disables this feature by
default; CommonJS dependencies such as throttler/JWT need it to load NestJS 12's
ESM packages. If managing `NODE_OPTIONS` in project settings, retain that flag
alongside any other required options and redeploy. Regression checks reproduce
the disabled-feature crash and load the real dependencies with the deployed flag.

See [Vercel's module interoperability setting](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module).

Production templates are in `apps/api/.env.production.example` and
`apps/web/.env.production.example`. Copy them to ignored `.env.production` files
and fill real settings; template files contain no credentials or usable domains.
Vercel runtime values belong in each project's environment settings. The local
API's ordinary `.env` and feature-development workflow remain unchanged.

Before promotion, run from the repository root:

```sh
pnpm release:check --api-origin https://YOUR-ACTUAL-API-HOST
```

The check reads those two production profiles and reports only pass/fail names,
never values. It checks origins, JWT/shared secrets, verified TLS configuration,
pool budgets, matching Supabase settings, public-only frontend configuration and
Turnstile. It exits unsuccessfully on incomplete configuration; an offline pass
does not prove TLS connectivity, migrations, SMTP delivery or deployed behavior.

Use the existing API example for JWT, Supabase, Turnstile and frontend origins.
Additionally set:

```dotenv
NODE_ENV=production
SECURITY_STATE_MODE=postgres
SECURITY_STATE_SECRET=<independent random secret of at least 32 characters>
DATABASE_URL=<supported Supabase pooled URL with sslmode=verify-full>
DB_POOL_MAX=<per-instance pool cap>
DB_POOL_MAX_PROCESSES=<host concurrency/instance budget including deployment overlap>
DB_POOL_CONNECTION_BUDGET=<allocated database connection budget>
```

These are placeholders, not deployable defaults. Configure actual pool numbers
within Supabase capacity and platform concurrency controls. A declared process
count does not cap Vercel autoscaling. Use provider pooling and load-test the
chosen limits. Configure the trusted Supabase CA before Node starts when needed;
do not use `sslmode=no-verify` or disable TLS verification.

Vercel sets `VERCEL=1`; the app then requires shared security state, verified
database TLS and explicit pool budgets. Do not set that flag on an ordinary
public Node server. Vercel's managed ingress overwrites `X-Forwarded-For`; the
Vercel path trusts only the adjacent hop and rejects a simultaneous
`TRUSTED_PROXY_CIDRS` setting. Other hosts retain explicit CIDR-based trust.

Use one shared security secret for all instances of an environment, distinct from
JWT keys. Preview environments must use separate databases/secrets. Rotating
this secret resets the ephemeral budgets, so coordinate it as a security change.

The API now accepts provider trust directly through `DATABASE_CA_CERT` (inline
PEM, recommended on Vercel) or `DATABASE_CA_CERT_PATH` (local absolute file path).
Use only one. The connection URL must specify `sslmode=verify-full`; the runtime
preserves verification while preventing URL options from overriding the explicit
CA. [Certificate setup](../apps/api/certs/README.md) covers the project download
and the separate Prisma migration CLI configuration.

## Shared protection

For the initial deployment testing phase, `apps/api/vercel.json` explicitly sets
`AUTH_BOT_CHALLENGE_ENABLED=false`. Turnstile credentials are not required in this
mode. Route and authentication rate limits and PostgreSQL shared security state
remain enabled. Re-enable challenges after configuring the API's Turnstile secret
and hostname, the frontend sitekey, and matching frontend security headers.
Keep any Vercel dashboard override consistent with this setting.

After backup/restore review, apply **all** pending migrations once in a controlled
release job, including `20261102020000_shared_security_state`. Nothing here runs
migrations on startup or alters the live database.

The new private table/function uses database time and transaction advisory locks
to share rolling route/IP limits, authentication source/account and global
attempt budgets, progressive bot risk, a shared verification-provider budget and
single-use challenge reservations.
Keys are HMAC digests; raw emails, IP addresses and tokens are never stored.
The table holds at most 50,000 active/expired keys, cleans expired entries during
allocation and rejects new identities when full. Failed checks never extend a
rate lockout. TTLs are at most 15 minutes; reservations last five minutes.
Browser roles cannot read or invoke this state. The trusted database connection
must own/have access to the migration's table and function.

Database or schema failure returns a safe 503 rather than opening a fresh local
budget. Readiness also checks the function in shared mode; liveness remains
independent. This does not certify every historical schema migration.

Local development defaults to the existing in-memory mode. Per-process CPU,
hashing and in-flight limits remain local resource protection in both modes;
they are not global fleet concurrency limits. Database-state queries add work to
each admitted route: measure latency, pool usage, lock contention and cost on
staging. The previous single-auth-owner restriction applies to **local** mode;
shared mode removes that restriction for the state covered above.

## Streams and uploads

SSE still authorizes before setup and rechecks live access before every delivery.
It sends heartbeats every 15 seconds and closes after 60 seconds. On Vercel the
handler remains pending until closure, and the setup deadline is cleared as soon
as SSE headers open. Channels/timers are cleaned on close or expiry. The browser
already reconnects and resynchronizes; transport loss never becomes an order
delta or duplicate notification. Verify a real deployment over multiple reconnect
cycles and confirm revoked access stops delivery. An open stream consumes function
resources; test the expected number of simultaneous shop/customer streams.

Image inputs are now capped at **4 MiB** (shown as 4 MB), with matching browser,
API and contract checks. This leaves multipart overhead below Vercel's 4.5 MB
request limit. Existing saved images remain usable. Larger inputs would require
a separately authorized direct-upload design; do not bypass validation.

## Checks before branch promotion

1. Run unit/HTTP/frontend tests, lint, builds, security release checks and leak scan.
2. Run `pnpm --filter api test:security:postgres` against the disposable fixture
   (bundled Windows PostgreSQL or `PG_BIN` pointing to local binaries).
3. Verify trusted TLS, migration status and readiness on staging.
4. Test OTP, recovery, email change, login flood limits across instances, uploads,
   order/payment flows and live stream reconnect/revocation on the actual host.
5. Confirm backup restoration, configured scaling budgets and host load results.
6. Merge reviewed work into `production`; do not deploy feature experiments from
   `main` against the production database.

Local checks do not establish a tested Vercel deployment. Pending live migration,
CA trust and credentials are still release requirements.

## Local verification on 2 November 2026

- API unit suite: **1,544 passed**; API HTTP suite: **2,219 passed**.
- Frontend suite: **2,383 passed**. Large concurrent runs initially hit timing
  failures; complete reruns with bounded workers passed without relaxing assertions.
- Disposable PostgreSQL: compiled services on two independent Prisma pools share
  token reservations and rolling budgets. Additional concurrent SQL checks cover
  risk caps, expiry, blocked retries, browser-role restrictions and bounded state.
- API and frontend lint, API build, nine Vercel configuration checks: passed.
- Frontend production build, release security policy and targeted secret scan:
  passed using process-only `/api/v1` and enforced CSP settings. Stored local
  environment files were not changed; this does not establish a working hosted proxy.

No branch was created, no live migration was applied, and no deployment was made.

Sources: [NestJS support](https://vercel.com/docs/frameworks/backend/nestjs),
[Function limits](https://vercel.com/docs/functions/limitations),
[Ingress headers](https://vercel.com/docs/headers/request-headers),
[Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).
