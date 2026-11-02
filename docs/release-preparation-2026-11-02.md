# Release preparation follow-up - 2 November 2026

Work remains on `main`. No branch was created, no deployment was published and
no live migration was applied. Local feature settings and credentials were not
rewritten. The user will explicitly command creation of a production branch.

## Implemented and verified

- API database connections accept a provider CA as `DATABASE_CA_CERT` or a local
  `DATABASE_CA_CERT_PATH`. Explicit trust requires `sslmode=verify-full`, rejects
  conflicting URL options and retains hostname/certificate verification. No TLS
  verification was disabled. The read-only preflight now reports TLS authorization
  and presence of shared security state as well as the earlier schema checks.
- Separate production environment examples contain no secrets or invented
  domains. `pnpm release:check` checks populated production profiles and emits
  only pass/fail check names. Missing/unsafe settings fail the command.
- The release configuration tests are included in `pnpm test:deployment` and
  therefore in the existing `pnpm verify` path.
- All **68 migration SQL files** were applied to a fresh disposable local
  PostgreSQL database, using the existing Supabase-role/storage/realtime stubs.
  All 17 catalog/cache integration checks passed. This is a clean-schema rehearsal,
  not a restore of live data or proof of a lock-free production migration.
- API unit tests: **1,548 passed**. API build, lint, **13 deployment tests** and
  the targeted repository/built-frontend secret scan passed.

The sanitized current configuration assessment is in
`artifacts/deployment-audit/2026-11-02/release-settings.json`. It deliberately
reports failure for the current development settings. A passing offline profile
is only one release check, not evidence of a completed deployment.

## Required inputs before the live steps

1. Download this project's **server root CA certificate** from Supabase Dashboard
   Database Settings → SSL Configuration. Save the public certificate as
   `apps/api/certs/supabase-ca.crt`. Certificate instructions are in that folder.
   Generic public download paths returned 404; no unverified certificate was trusted.
2. Supply the stable public Vercel frontend and API URLs. These determine CORS,
   callback/widget hostnames, QR URLs and the actual frontend API rewrite.
3. Configure real Turnstile site/secret keys for that frontend hostname. Store
   private keys only in ignored backend/host settings, never in chat or browser config.
4. Choose database connection/instance budgets against the actual Supabase and
   Vercel resources; declared numbers alone do not cap serverless scaling.

The last live read-only check still found no encrypted database connection,
missing catalog-cache schema and zero registration-policy columns. No trusted
CA, direct migration connection, Supabase management credential or Vercel
credential is configured locally. Live backup/restore and migration work cannot
be represented as complete with these inputs missing.

After certificate verification: create and verify a recoverable live backup,
recheck migration status and data invariants, apply the reviewed pending migrations
once with bounded lock/statement times, then recheck schema/readiness. Test hosted
OTP/recovery/email change, uploads, orders/payments, role access and stream
reconnection before public release. These require a real configured host.

Source: [Supabase certificate verification](https://supabase.com/docs/guides/platform/ssl-enforcement).
