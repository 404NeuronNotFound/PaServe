# Account registration

`POST /api/v1/auth/register` accepts only `email` and `password`.
The form at `/register` also asks for password confirmation, validated locally
and never sent to the API. Passwords are 12–128 characters, are not trimmed,
and must contain a non-space character. Emails are trimmed/lowercased.

Success: HTTP 201 with `{ "user": { "id": "…", "email": "…", "createdAt": "…" } }`.
No password/hash/session token is returned. This step creates an account only;
shop onboarding follows separately. Sign in through the login endpoint below.

Failures use `{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "…", "fieldErrors": { "email": ["…"] } }`.
Duplicate emails return HTTP 409 and `EMAIL_ALREADY_EXISTS`. Unrecognized fields
(including role, shopId, or passwordHash) are rejected. Unexpected failures return
a generic HTTP 500 without database details.

Argon2id hashes are persisted through AuthRepository/Prisma. A functional unique
index on `lower(btrim(email))` protects concurrent and mixed-case duplicates.
Users have RLS enabled and browser database privileges revoked. NestJS owns all
account access; Supabase Auth is not used. Health endpoints remain unchanged,
and the existing frontend connection screen is available at `/connection`.

# Login and sessions

`POST /api/v1/auth/login` accepts only `email` and `password`.
Send `X-PaServe-Client: web`; browser requests must also originate from an entry
in `FRONTEND_ORIGINS`. Emails are normalized, passwords are preserved exactly.
Login accepts existing passwords without imposing the registration minimum;
it validates nonempty input and the existing 128-character upper bound.

NestJS fetches the account, verifies its Argon2 hash, and requires `isActive=true`.
An unknown email, incorrect password, or inactive account returns the same
HTTP 401 `INVALID_CREDENTIALS` message. Invalid DTOs return HTTP 400.
Login is limited to 10 attempts per IP per minute, returning HTTP 429 afterward.
Registration is limited to 5 attempts per IP per minute before account lookup
or password hashing. Invalid requests consume the limit too.
The initial limiter uses process-local storage; shared enforcement is needed
when deploying multiple API instances.

Success: HTTP 200 with `{ user: { id, email, createdAt }, accessToken,
tokenType: "Bearer", expiresIn: 900 }`. No passwords, hashes, or refresh tokens
appear in the JSON body. Both tokens are JWTs signed with distinct backend-only
secrets, with issuer, audience, purpose, and expiry validation. No user-level
staff role is assigned or embedded in the token.

The access token lasts 15 minutes and stays in a memory-only Zustand store.
The refresh token is delivered in an HttpOnly `paserve_refresh` cookie scoped to
`/api/v1/auth`. It expires after seven days, has SameSite=Lax locally, and uses
Secure/SameSite=None in production for the separate frontend/API origins.
Only its SHA-256 digest is stored in `auth_sessions`. Account sessions are
user-owned, not shop-owned; their table has RLS and denies browser DB access.

`POST /api/v1/auth/refresh` accepts an empty body and the refresh cookie.
It rotates the token atomically. Reuse of a valid signed token after rotation
revokes the entire session, invalidating the current refresh and access tokens.
Concurrent refreshes have one successful rotation, but detection of the losing
replay revokes that session too. The absolute seven-day expiry is preserved.
Separate browser tabs must coordinate rotation to avoid forced re-login; the
current frontend only coalesces refresh requests within one tab.
The frontend coalesces refresh requests and retries an expired access token once.

`GET /api/v1/auth/me` requires `Authorization: Bearer <accessToken>` and
returns `{ user: { id, email, createdAt, firstName, lastName, memberships } }`.
Names are nullable; accounts without memberships receive an empty array.
Each membership contains `id`, `shopId`, `role`, and `shop: { id, name, slug,
isActive }`. Memberships are scoped to the authenticated user and read from
PostgreSQL on each request; inactive shops remain visible with `isActive: false`.
Password hashes, session credentials, and other users' profiles are excluded.
JwtAuthGuard checks both JWT
validity and the live account/session, so inactive accounts and revoked sessions
are rejected immediately. Responses carrying session data use Cache-Control:
no-store.

The frontend `/app` route guards all nested owner/staff pages, currently
`/app/account`; `/app` redirects authenticated users to that page. Guests are
sent to `/login`, and network failures show a retry action. Backend JWT guards
remain the security boundary: `/auth/me` is protected independently of the UI.
The shop and product controller scaffolds apply `JwtAuthGuard` at controller
level and import `AuthModule`; they currently have no HTTP handlers. Add private
operator pages under `/app` and private handlers to these guarded controllers.
Public customer endpoints should use separate public controllers. Authentication
does not grant a shop role; shop membership authorization is still separate.

`POST /api/v1/auth/logout` accepts an empty body and the refresh cookie. It revokes
the session, clears the cookie and returns HTTP 204. Missing/invalid cookies are
handled idempotently. Cookie endpoints require the custom header and trusted
browser origin to prevent cross-site form requests.

## Local setup and testing

Distinct, random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values (at least
32 characters) are required in `apps/api/.env`. Local values have been configured;
examples intentionally leave them blank. Set these separately in the deployment
environment. The API refuses to initialize if they are missing or identical.
Keep all JWT keys out of Vite environment variables.

Restart the API and Vite after pulling/installing dependencies. Open
`http://localhost:5173/register`, create an account, follow “Sign in to continue”,
and sign in at `/login`. Success opens the protected `/app/account` page.
Reload to verify cookie-based session restoration; sign out and confirm that
reopening `/app/account` redirects to `/login`. Try an incorrect password and an
invalid email to check recovery. Shop onboarding and shop role authorization
remain the next foundation steps.

Run `pnpm --filter api test`, `pnpm --filter api test:e2e`, and
`pnpm --filter web test` for regression checks. HTTP tests mock the repository;
a separate live smoke test also verified the migration, registration, login,
deactivation, current user, refresh rotation and logout against the configured
PostgreSQL database. Its temporary account and sessions were removed.

For production use HTTPS and configure the exact frontend origins. Separate
hosting domains require third-party cookies, which some browsers block; prefer
frontend/API domains under the same site before deployment. Configure trusted
proxy handling for the hosting platform before relying on per-client IP limits.
