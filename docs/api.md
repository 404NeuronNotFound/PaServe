# Account registration

`POST /api/v1/auth/register` accepts only `email` and `password`.
The form at `/register` also asks for password confirmation, validated locally
and never sent to the API. Passwords are 12–128 characters, are not trimmed,
and must contain a non-space character. Emails are trimmed/lowercased.

Success: HTTP 201 with `{ "user": { "id": "…", "email": "…", "createdAt": "…" } }`.
No password/hash/session token is returned. This step creates an account only;
shop onboarding, login, and sessions follow separately.

Failures use `{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "…", "fieldErrors": { "email": ["…"] } }`.
Duplicate emails return HTTP 409 and `EMAIL_ALREADY_EXISTS`. Unrecognized fields
(including role, shopId, or passwordHash) are rejected. Unexpected failures return
a generic HTTP 500 without database details.

Argon2id hashes are persisted through AuthRepository/Prisma. A functional unique
index on `lower(btrim(email))` protects concurrent and mixed-case duplicates.
Users have RLS enabled and browser database privileges revoked. NestJS owns all
account access; Supabase Auth is not used. Health endpoints remain unchanged,
and the existing frontend connection screen is available at `/connection`.
