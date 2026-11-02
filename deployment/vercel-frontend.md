# PaServe frontend on Vercel

Import the same GitHub repository's `production` branch as a separate frontend
project. The root `vercel.json` now defines this project, including SPA fallback,
security headers and the `/api/v1` proxy to:

`https://paserve-api-2l5w.vercel.app`

Use these settings:

| Setting | Value |
| --- | --- |
| Project name | `paserve` (or another available name) |
| Branch | `production` |
| Root Directory | repository root `./` |
| Framework | Vite |
| Node.js | 24.x |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm --filter web build` |
| Output directory | `apps/web/dist` |

If the import screen selects Services or `apps/web`, change the preset to Vite
and the Root Directory to `./` so this configuration is used.

Production frontend environment variables:

- `VITE_API_URL=/api/v1`
- `VITE_SUPABASE_URL`: the current public project URL from `apps/web/.env`.
- `VITE_SUPABASE_ANON_KEY`: the public anon/publishable key from that same file.
- `CSP_REPORT_ONLY=false`
- `VITE_PUBLIC_APP_URL`: set to the actual frontend origin after it is assigned;
  it may initially be omitted because QR links fall back to the browser origin.
- Google client ID and Turnstile site key: configure when the integrations are
  ready. Their public keys must match the API/provider settings.

Do not copy backend secrets, database URLs, service-role keys or Brevo SMTP keys
into the frontend project. Private environment files are not committed.

Vercel automatically supplies public framework metadata such as
`VITE_VERCEL_GIT_REPO_ID`, deployment URLs and commit information. The build guard
accepts the documented metadata names while still checking their values for
private credentials. Other `VITE_VERCEL_*` names are not automatically trusted.
See [Vercel framework variables](https://vercel.com/docs/environment-variables/framework-environment-variables).

The committed host CSP was generated from current public frontend configuration.
If enabling Google, Turnstile or extra CSP origins, regenerate it with the same
frontend environment before deploying, then commit the reviewed configuration:

```sh
node --env-file=apps/web/.env.production scripts/prepare-vercel.mjs --api-origin https://paserve-api-2l5w.vercel.app --output vercel.json
```

After the frontend URL is assigned, add that exact origin to API
`FRONTEND_ORIGINS` and configure provider callback/widget hostnames as needed.

At setup verification, API liveness/readiness returned HTTP 500 with
`FUNCTION_INVOCATION_FAILED`. Runtime logs identified the NestJS 12/throttler
CommonJS-to-ESM boundary. The API configuration now declares Node 24 and enables
`--experimental-require-module`; verify the new hosted deployment's health before
claiming sign-in, registration or orders work. A successful frontend build alone
does not validate API startup, database TLS/schema or provider configuration.
