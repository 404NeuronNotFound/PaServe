import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokensService } from '../dist/modules/auth/tokens.service.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { OrderTokenService } from '../dist/modules/orders/order-token.service.js';

// Production credential/permission services; isolated repositories contain no real users.
export async function fanoutIdentities(tenants) {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
  });
  const tokens = new TokensService(new JwtService(), config),
    orderTokens = new OrderTokenService(config);
  const actors = [],
    sessions = new Map(),
    memberships = new Map();
  const counters = {
    checks: 0,
    denied: 0,
    byRole: { CUSTOMER: 0, CASHIER: 0, KITCHEN: 0, OWNER: 0 },
  };
  for (const [tenant, target] of tenants.entries()) {
    target.credentialOrder = {
      id: target.orderId,
      shopId: target.shopId,
      ...orderTokens.metadata(),
      qrTokenRevokedAt: null,
      receiptAccessRevokedAt: null,
    };
    for (const role of ['CUSTOMER', 'OWNER', 'CASHIER', 'KITCHEN']) {
      const actor = {
        id: randomUUID(),
        tenant,
        role,
        shopId: target.shopId,
        revoked: false,
      };
      if (role === 'CUSTOMER')
        actor.credential = orderTokens.issueTracking(target.credentialOrder);
      else {
        const sessionId = randomUUID(),
          pair = await tokens.issue(
            actor.id,
            sessionId,
            new Date(Date.now() + 300000),
          );
        actor.credential = pair.accessToken;
        const membership = {
          id: randomUUID(),
          shopId: target.shopId,
          role,
          disabledAt: null,
          user: { isActive: true },
          shop: {
            id: target.shopId,
            name: 'Synthetic fanout shop',
            slug: `fanout-${tenant}`,
            isActive: true,
            logoUrl: null,
          },
        };
        memberships.set(`${actor.id}:${target.shopId}`, membership);
        sessions.set(sessionId, {
          user: {
            id: actor.id,
            email: 'fixture@load.example.test',
            createdAt: new Date(),
            memberships: [membership],
          },
          actor,
        });
      }
      actors.push(actor);
    }
  }
  const auth = new AuthService(
    {
      async findSession(id, userId) {
        const value = sessions.get(id);
        return value && !value.actor.revoked && value.user.id === userId
          ? value
          : null;
      },
    },
    tokens,
    {},
  );
  const members = new ShopMembersService({
    async findMembership(userId, shopId) {
      return memberships.get(`${userId}:${shopId}`) ?? null;
    },
  });
  async function authorize(actor, target, credential = actor.credential) {
    counters.checks++;
    counters.byRole[actor.role]++;
    try {
      if ((actor.role === 'CUSTOMER') !== (target.kind === 'customer'))
        throw new Error('Wrong credential purpose for channel.');
      if (actor.role === 'CUSTOMER') {
        const order = tenants[target.tenant].credentialOrder;
        const reference = orderTokens.resolveTrackingReference(
          credential,
          target.scope.shopId,
        );
        assert.equal(reference.orderId, target.orderId);
        orderTokens.verifyTracking(credential, order);
      } else {
        const current = await auth.currentUser(credential);
        await members.requirePermission(
          current.id,
          target.scope.shopId,
          target.kind === 'kitchen'
            ? 'shop.preparation.queue.read'
            : 'shop.orders.read',
        );
      }
    } catch (error) {
      counters.denied++;
      throw error;
    }
  }
  async function negativeMatrix(targets) {
    const rejected = async (action) => {
      try {
        await action();
        return false;
      } catch {
        return true;
      }
    };
    const cashier = actors.find((a) => a.tenant === 0 && a.role === 'CASHIER'),
      kitchen = actors.find((a) => a.tenant === 0 && a.role === 'KITCHEN');
    const owner = actors.find((a) => a.tenant === 0 && a.role === 'OWNER'),
      customer = actors.find((a) => a.tenant === 0 && a.role === 'CUSTOMER');
    const staff = targets.find((t) => t.tenant === 0 && t.kind === 'cashier'),
      prep = targets.find((t) => t.tenant === 0 && t.kind === 'kitchen'),
      guest = targets.find((t) => t.tenant === 0 && t.kind === 'customer');
    return {
      ownerStaffAndKitchen: await authorize(owner, staff)
        .then(() => authorize(owner, prep))
        .then(
          () => true,
          () => false,
        ),
      cashierDeniedKitchen: await rejected(() => authorize(cashier, prep)),
      kitchenDeniedCashier: await rejected(() => authorize(kitchen, staff)),
      foreignMembership: await rejected(() =>
        authorize(
          owner,
          targets.find((t) => t.tenant === 1 && t.kind === 'cashier'),
        ),
      ),
      invalidStaffToken: await rejected(() =>
        authorize(owner, staff, 'invalid'),
      ),
      foreignCustomer: await rejected(() =>
        authorize(
          customer,
          targets.find((t) => t.tenant === 1 && t.kind === 'customer'),
        ),
      ),
      wrongCustomerOrder: await rejected(() =>
        authorize(customer, { ...guest, orderId: randomUUID() }),
      ),
      tamperedCustomer: await rejected(() =>
        authorize(customer, guest, customer.credential + 'x'),
      ),
    };
  }
  return {
    actors,
    authorize,
    negativeMatrix,
    counters,
    revoke(actor) {
      actor.revoked = true;
      if (actor.role === 'CUSTOMER')
        tenants[actor.tenant].credentialOrder.receiptAccessRevokedAt =
          new Date();
    },
    disable(actor) {
      memberships.get(`${actor.id}:${actor.shopId}`).disabledAt = new Date();
    },
    setRole(actor, role) {
      memberships.get(`${actor.id}:${actor.shopId}`).role = role;
    },
  };
}
