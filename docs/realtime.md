# Realtime foundation

`public.products` is enabled in the `supabase_realtime` publication through a
Prisma SQL migration. User identities and shop memberships are not published.

Products have RLS enabled and no direct access for `anon` or `authenticated`.
NestJS continues to access PostgreSQL through Prisma. Only the backend
service-role client is used for the current live subscription test.

This verifies infrastructure, not customer/staff subscription authorization.
Channel names and `shopId` filters are not security boundaries. Before frontend
subscriptions are introduced, define explicit tenant-aware authorization using
NestJS-issued identity and scoped access. Do not put the service-role key in Vite.
No Supabase Auth accounts are required or created.

## Verify

From the monorepo root:

```sh
pnpm --filter api build
pnpm --filter api test:realtime
```

The check uses backend `.env` and the frontend `.env` anon key. It checks
publication membership, RLS, denied browser reads, and a live WebSocket update
after a Prisma write. It verifies a shop filter excludes another shop's update.
The fixtures are inactive shops and their products, removed after the check.

`products` uses UPDATE subscriptions only. Deletion notifications and future
order subscriptions require separate access design; do not publish all tables.
