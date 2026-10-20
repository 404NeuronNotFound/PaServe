# PaServe API authorization conventions

- Every authenticated tenant business route must use `@ShopMember()`,
  `@Roles(...)`, or `@ShopResource(...)` as appropriate. Shop creation and
  account/session routes have their separate identity-level policies.
- Derive the actor from authentication and the target shop from the explicit
  route parameter. Never authorize using client-supplied roles, membership
  objects, query/header shop hints, or another resource's ID alone.
- Scope every tenant-owned database operation to the validated `shopId`.
  Reuse `modules/tenancy/shop-scope.ts` and live membership/permission checks.
  Resource reads/writes require both the resource ID and shop ID; validate
  related category/product IDs against that same shop. Lists/counts also need
  the shop predicate. Account membership lists are scoped to the authenticated
  user, not an arbitrary client-selected tenant.
- Repeat relevant live access and source-state predicates in database reads
  and conditional writes. A successful guard does not prevent later role changes.
  Restrict update data to a validated field allowlist; avoid tenant reassignment
  through spread request bodies. Do not expose another tenant's resource existence.
- Preserve RLS and revoked anon/authenticated browser table privileges for
  shops, memberships, categories and products. NestJS owns access today.
- Preserve the SQL-maintained `products_price_nonnegative` CHECK constraint
  from migration `20261010050000_product_price_constraint`. Keep product prices
  as Decimal(10,2), accept exact decimal strings and serialize with two places.
- Preserve `restaurant_tables_number_nonempty` and the case-insensitive per-shop
  label index from migration `20261011210000_table_number_labels`, along with
  per-shop number/code uniqueness, RLS and revoked browser table privileges.
  This migration supersedes the numeric range CHECK to support human-facing labels.
- Migration `20261009160000_tenant_resource_isolation` contains an additional
  SQL-maintained composite product/category foreign key. Preserve it in future
  migrations: Prisma cannot express its column-specific `ON DELETE SET NULL`.
  It rejects cross-shop relationships and category moves while retaining the
  product's shop ID on category deletion. PostgreSQL 15+ is required.
- For new tenant resources, extend the explicit resource policy and tests;
  never add an arbitrary model/table name lookup. Follow
  [tenant isolation guidance](../../docs/security.md#tenant-isolation).
