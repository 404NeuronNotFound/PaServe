# Supabase verified registration and Google sign-in

PaServe uses its live Supabase project for email ownership checks and Google
identity verification. NestJS continues to own PaServe accounts, memberships,
authorization and sessions. Existing passwords and accounts keep working.

New accounts require first and last names (1-80 characters). The email flow calls
`POST /auth/email-code`, which uses Supabase `signInWithOtp` to deliver an email.
The user enters the code with names and a password; `POST /auth/register` verifies
it with Supabase `verifyOtp` before creating a local account. Supabase controls
OTP expiry, limits and consumption. A repeated email never replaces local
credentials or reveals whether an account exists. No custom mail provider or
challenge table is required. The email OTP creates a Supabase Auth identity but
PaServe password management remains in the existing API.

Google uses the official GIS button, with Supabase `signInWithIdToken` on the API.
A random HttpOnly nonce cookie binds the browser request; GIS receives its SHA-256
hash and Supabase receives the original nonce. Only confirmed Gmail or Google
Workspace identities are accepted. Local accounts use Google's stable subject.
Unknown Google users must use Create account and provide names first. Matching
emails never automatically attach Google to an existing PaServe password account.
Google sign-in exchanges the verified identity for PaServe's existing HttpOnly
refresh cookie and memory-only access token. Supabase Auth clients are isolated
per request with session persistence and auto-refresh disabled.

## Enable on the existing Supabase project

1. Keep API `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured as today.
   Optionally set API `SUPABASE_ANON_KEY` to the project's public key for Auth
   calls. It falls back to the server-only service-role key; no key is sent to
   browsers by these endpoints.
2. In Supabase Authentication, enable Email. Configure the **Magic Link** email
   template to include `{{ .Token }}` so the email contains the code used by this
   form. Set OTP expiry and rate limits in Supabase. Configure Supabase's custom
   SMTP for production delivery if the built-in sender limits are insufficient.
   This flow does not depend on link callbacks.
3. Enable Google under Supabase Authentication providers. Configure Google's Web
   OAuth client ID and secret there. Register the Supabase callback URL shown by
   the dashboard in Google Cloud, and each exact PaServe frontend origin as an
   authorized JavaScript origin. Configure the Google consent screen/test users.
4. Set frontend `VITE_GOOGLE_CLIENT_ID` to that same Google Web client ID, rebuild
   and deploy generated CSP headers. Leave it empty to hide Google buttons until
   configured. The Google secret stays in Supabase. Google popups use the specific
   GIS CSP sources and `same-origin-allow-popups` COOP only when enabled.
5. Apply the additive migration with `pnpm --filter api exec prisma migrate deploy`
   through the usual deployment process and regenerate Prisma as needed. It adds
   nullable `googleSubject` (unique) and `emailVerifiedAt` columns; existing users
   are preserved and historical emails are not marked verified. No live database
   settings or schema are changed merely by editing this repository.
6. Verify real code delivery, rejection of incorrect/expired/reused codes, Google
   consent, registration, sign-in, refresh and logout on the deployed origin.

A database failure after Supabase consumes an OTP requires a new emailed code.
The form supports requesting a new code and retains input values on errors.
Google-only accounts have a generated unguessable local password; the existing
password-based email/password editor requires a separate password setup flow
before it can be used by those users. Email changes clear the verification flag.

Automated tests mock the Supabase Auth boundary and test rejection and local
account/session behavior. Live email and Google consent require enabled project
settings and real credentials; they cannot be verified from repository code alone.

References: [Supabase Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[Google ID token sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithidtoken).


## Troubleshooting verification delivery

An initial `/auth/refresh` 401 is expected when a signed-out browser has no valid
PaServe session. It does not prevent requesting an email verification code.

`/auth/email-code` previously converted every Supabase delivery error into one
503. It now distinguishes these outcomes without exposing provider messages:

- `EMAIL_DELIVERY_NOT_CONFIGURED` (503): Supabase returned
  `email_address_not_authorized`. Its default sender only sends to authorized
  project organization members. Configure **Supabase Authentication > Emails >
  SMTP Settings** with a verified sender to deliver codes to normal users. Keep
  the email template's `{{ .Token }}` variable and email confirmation enabled.
- `EMAIL_RATE_LIMITED` (429): Supabase's email/request sending budget is exhausted.
  Wait for the budget to reset; repeated retries do not fix it. Check the project's
  Auth rate limits and configured SMTP provider limits.
- `EMAIL_SIGNUP_DISABLED` (503): Email OTP/signup is disabled in Supabase Auth.
- `EMAIL_UNAVAILABLE` (503): Other provider or delivery failures. Inspect Supabase
  Auth logs, SMTP credentials/sender verification and connectivity.
- `IDENTITY_UNAVAILABLE` (503): API Supabase URL/key configuration is missing.

The API logs `verification_email_failed` with a bounded reason and HTTP status,
never the submitted email, OTP, API key or raw provider diagnostic. The form shows
the specific safe error and keeps entered details. Do not disable confirmation or
return a fake success to work around delivery failures.

See [Supabase SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
and [Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes).
