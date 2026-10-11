# Active shop

Latest audit: [Phase 2 verification](phase-2-verification.md). Membership is
validated on route entry; automatic focus/reconnection refreshes are disabled
to preserve in-progress settings drafts. API operations still check live access.

Status: **Done**. Acceptance criterion: "A multi-shop user can select a shop;
API requests are scoped to that shop; unauthorized shop IDs are rejected."

- Passed: multiple-shop selection and switching update the workspace and its role.
- Passed: requests capture the selected shop ID in the URL; API guards and
  database writes validate that exact target.
- Passed: malformed IDs receive 400; inaccessible, removed, or inactive shop
  contexts receive 404; insufficient permission for owner operations receives
  403. Suggested active-shop headers cannot override authorization.

Checked against the implementation and acceptance tests. The latest verification
passed 69 frontend tests and 108 API HTTP tests, the frontend production build,
and frontend/API lint. Visual browser inspection remains unverified because no
in-app browser connection was available.

Open **Manage [shop name]** on the account page, or visit `/app/shops` to choose
a shop. The workspace is `/app/shops/:shopId`; **Switch shop** returns to the
selector. Direct URLs and page reloads revalidate access before showing the
shop name, slug, and the user's current role.

Sign-in fetches a fresh complete account profile. `/app` resolves the current user's remembered available shop, then their only
available shop. Multiple available shops require a choice; no available shops
opens the account page with shop creation. Inactive shops cannot be selected.
The last validated choice is stored in user-keyed session storage, survives
reload in that tab, and is cleared on successful sign-out. Blocked storage does
not prevent selection. No roles, memberships, or credentials are persisted.

## Context and authorization

The URL is the target; a saved choice is only a navigation hint. Every workspace
entry calls `GET /api/v1/shops/:shopId/membership`. The existing API membership
guard validates the live session, active user/shop, and current membership for
that exact ID. A stale profile or remembered choice cannot authorize access.
Missing/removed/inactive contexts show a recovery link, without silently opening
another shop. Connection failures offer retry; expired sessions return to sign-in.

Business screens nest under `ActiveShopRoute` and obtain their validated
membership from `useActiveShop()`. Query keys contain both user ID and shop ID;
context data is hidden during revalidation and discarded when unused. The
membership fetch consumes an abort signal. Responses with a different shop ID
or inactive shop are rejected. API requests capture the shop ID in the URL;
selection changes cannot retarget an in-flight request. Separate tabs can
manage different shops.

All current tenant operations validate explicit context: membership reads use
`ShopMembershipGuard`; settings writes use `ShopOwnerGuard` and repeat active
OWNER membership constraints in the database update. Suggested active-shop
headers cannot override the route or grant access. A write without a shop target
is rejected. Shop creation and authentication are account-level operations and
do not require an existing active shop. Products currently has no handlers.

Future business endpoints must include `:shopId`, run the membership/appropriate
role guard after authentication, derive the target from the validated request
membership, and scope database reads/writes to that target. Frontend queries and
mutations must use the validated active shop ID. Public menu lookup by slug is
separate from authenticated management context.

Active-shop selection needs no database migration or global active-shop field.
The [settings screen](shop-settings.md) now runs under the validated active-shop
route. The [owner dashboard shell](owner-dashboard-shell.md) now wraps the shop
overview and settings pages.

## Verification

Frontend tests cover selection, restoration, user isolation, inactive shops,
URL precedence, changing roles on switch, cached access revocation, missing
access, retry, expired sessions, response context validation, and explicitly
targeted writes. API HTTP tests cover live membership/owner authorization and
reject attempted context overrides and missing targets. Browser visual checks
require an available in-app browser connection.
