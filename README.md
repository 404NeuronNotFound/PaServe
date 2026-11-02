# PaServe production

This branch contains the deployable API, frontend, shared contracts, database
migrations, and operational/security configuration. Feature development,
automated tests, demo seeds and generated audit/load-test evidence remain on
`main`. Historical documentation may describe development commands that are
intentionally absent from this branch.

## Validate a release

```sh
pnpm --filter api db:generate
pnpm lint
pnpm build
pnpm check:secrets
pnpm audit --audit-level=low
```

Use `pnpm release:check --api-origin https://YOUR-API-HOST` with complete local
production profiles to validate deployment settings. Follow the guides in
`deployment/` for the two Vercel projects and database migration procedure.

## Data and branch boundaries

Git branches do not isolate Supabase databases. The initial shared dummy data
was cleared on 2026-11-02 after explicit approval and a private backup of the
database and stored objects. Application tables, Supabase Auth users and PaServe
storage objects were emptied; schema, policies, buckets and migration history
were retained. No reset runs automatically during builds, deploys or startup.

The backup is local and ignored by Git. New users must register and create their
shops. Use separate Supabase projects when development data must be isolated
from production.
