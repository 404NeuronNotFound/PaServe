import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fanoutIdentities } from './realtime-fanout.identity.mjs';
function targets(tenants) {
  return tenants.flatMap((t, tenant) =>
    ['cashier', 'kitchen', 'customer'].map((kind) => ({
      tenant,
      kind,
      scope: {
        shopId: t.shopId,
        ...(kind === 'customer' ? { orderId: t.orderId } : {}),
      },
      orderId: t.orderId,
    })),
  );
}
async function fixture() {
  const tenants = Array.from({ length: 3 }, () => ({
    shopId: randomUUID(),
    orderId: randomUUID(),
  }));
  return {
    identity: await fanoutIdentities(tenants),
    topics: targets(tenants),
  };
}
await test('real credential/permission services permit all four subscriber roles and reject the negative matrix', async () => {
  const { identity, topics } = await fixture();
  assert.ok(
    Object.values(await identity.negativeMatrix(topics)).every(Boolean),
  );
  for (const actor of identity.actors) {
    const kind =
      actor.role === 'CUSTOMER'
        ? 'customer'
        : actor.role === 'KITCHEN'
          ? 'kitchen'
          : 'cashier';
    await identity.authorize(
      actor,
      topics.find((t) => t.tenant === actor.tenant && t.kind === kind),
    );
  }
});
await test('membership changes are rechecked with the original signed session', async () => {
  const { identity, topics } = await fixture(),
    actor = identity.actors.find((a) => a.role === 'CASHIER' && a.tenant === 0);
  const cashier = topics[0],
    kitchen = topics[1];
  await identity.authorize(actor, cashier);
  identity.setRole(actor, 'KITCHEN');
  await assert.rejects(() => identity.authorize(actor, cashier));
  await identity.authorize(actor, kitchen);
  identity.disable(actor);
  await assert.rejects(() => identity.authorize(actor, kitchen));
});
await test('revoked customer credentials and signed staff sessions cannot retain relay access', async () => {
  const { identity, topics } = await fixture();
  for (const role of ['CUSTOMER', 'OWNER']) {
    const actor = identity.actors.find(
        (a) => a.tenant === 0 && a.role === role,
      ),
      target = topics.find(
        (t) =>
          t.tenant === 0 &&
          t.kind === (role === 'CUSTOMER' ? 'customer' : 'cashier'),
      );
    await identity.authorize(actor, target);
    identity.revoke(actor);
    await assert.rejects(() => identity.authorize(actor, target));
  }
});
await test('staff JWTs and customer receipt credentials cannot substitute for one another', async () => {
  const { identity, topics } = await fixture(),
    customer = identity.actors.find(
      (a) => a.role === 'CUSTOMER' && a.tenant === 0,
    ),
    owner = identity.actors.find((a) => a.role === 'OWNER' && a.tenant === 0);
  await assert.rejects(() => identity.authorize(owner, topics[2]));
  await assert.rejects(() => identity.authorize(customer, topics[0]));
  await assert.rejects(() =>
    identity.authorize(customer, topics[2], owner.credential),
  );
  await assert.rejects(() =>
    identity.authorize(owner, topics[0], customer.credential),
  );
});
