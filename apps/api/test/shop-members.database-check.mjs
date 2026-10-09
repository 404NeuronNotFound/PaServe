// Run after the API build, from apps/api. Every fixture is rolled back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ShopsRepository } from '../dist/modules/shops/shops.repository.js';
import { ShopsService } from '../dist/modules/shops/shops.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';

const prisma = new PrismaService();
const fixtureKey = randomUUID();
const emails = [
  `member-a-${fixtureKey}@example.com`,
  `member-b-${fixtureKey}@example.com`,
];
const rollback = new Error('Intentional fixture rollback');
try {
  const [audit] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total,
      (COUNT(*) - COUNT(DISTINCT (m."userId", m."shopId")))::int AS duplicates,
      COUNT(*) FILTER (WHERE u.id IS NULL OR s.id IS NULL OR m.role IS NULL)::int AS invalid
    FROM public.shop_members m
    LEFT JOIN public.users u ON u.id = m."userId"
    LEFT JOIN public.shops s ON s.id = m."shopId"`;
  assert.equal(audit.duplicates, 0);
  assert.equal(audit.invalid, 0);
  const globalRoleColumns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name IN ('role', 'roles', 'shopRole', 'globalRole')`;
  assert.equal(
    globalRoleColumns.length,
    0,
    'Shop roles must not be stored globally on User',
  );
  console.log(
    `Audited ${audit.total} existing memberships: valid user/shop links, roles, and unique pairs.`,
  );

  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const userA = await tx.user.create({
          data: { email: emails[0], passwordHash: 'unused-test-hash' },
        });
        const userB = await tx.user.create({
          data: { email: emails[1], passwordHash: 'unused-test-hash' },
        });
        const shops = new ShopsService(new ShopsRepository(tx));
        const memberships = new ShopMembersService(
          new ShopMembersRepository(tx),
        );
        const { shop: shopA } = await shops.create(userA.id, {
          name: `Member A ${fixtureKey}`,
        });
        const { shop: shopB } = await shops.create(userB.id, {
          name: `Member B ${fixtureKey}`,
        });
        assert.deepEqual(
          await tx.user.findUnique({ where: { id: userA.id } }),
          userA,
        );
        assert.deepEqual(
          await tx.user.findUnique({ where: { id: userB.id } }),
          userB,
        );
        assert.equal(
          (await memberships.requireMembership(userA.id, shopA.id)).role,
          'OWNER',
        );
        await assert.rejects(
          memberships.requireMembership(userA.id, shopB.id),
          (error) => error.status === 404,
        );
        await tx.shopMember.create({
          data: { userId: userA.id, shopId: shopB.id, role: 'CASHIER' },
        });
        await tx.shopMember.create({
          data: { userId: userB.id, shopId: shopA.id, role: 'KITCHEN' },
        });
        assert.equal(
          (await memberships.requireMembership(userA.id, shopB.id)).role,
          'CASHIER',
        );
        assert.equal(
          (await memberships.requireMembership(userB.id, shopA.id)).role,
          'KITCHEN',
        );
        assert.equal(
          (await memberships.requireMembership(userB.id, shopB.id)).role,
          'OWNER',
        );
        // A staff member creating another shop owns only the new relationship.
        const { shop: shopC } = await shops.create(userA.id, {
          name: `Member C ${fixtureKey}`,
        });
        assert.equal(
          (await memberships.requireMembership(userA.id, shopC.id)).role,
          'OWNER',
        );
        assert.equal(
          (await memberships.requireMembership(userA.id, shopB.id)).role,
          'CASHIER',
        );
        assert.equal(
          await tx.shopMember.count({
            where: { userId: userA.id, shopId: shopC.id, role: 'OWNER' },
          }),
          1,
        );
        assert.deepEqual(
          await tx.user.findUnique({ where: { id: userA.id } }),
          userA,
        );

        async function expectConstraintFailure(data, expectedCode) {
          await tx.$executeRaw`SAVEPOINT membership_constraint_check`;
          let failure;
          try {
            await tx.shopMember.create({ data });
          } catch (error) {
            failure = error;
          }
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT membership_constraint_check`;
          await tx.$executeRaw`RELEASE SAVEPOINT membership_constraint_check`;
          assert.equal(failure?.code, expectedCode);
        }
        await expectConstraintFailure(
          { userId: userA.id, shopId: shopA.id, role: 'ADMIN' },
          'P2002',
        );
        assert.equal(
          (await memberships.requireMembership(userA.id, shopA.id)).role,
          'OWNER',
        );
        await expectConstraintFailure(
          { userId: randomUUID(), shopId: shopA.id, role: 'CASHIER' },
          'P2003',
        );
        await expectConstraintFailure(
          { userId: userA.id, shopId: randomUUID(), role: 'CASHIER' },
          'P2003',
        );

        await tx.shopMember.update({
          where: { userId_shopId: { userId: userA.id, shopId: shopB.id } },
          data: { role: 'MANAGER' },
        });
        assert.equal(
          (await memberships.requireMembership(userA.id, shopB.id)).role,
          'MANAGER',
        );
        await tx.shop.update({
          where: { id: shopB.id },
          data: { isActive: false },
        });
        await assert.rejects(
          memberships.requireMembership(userA.id, shopB.id),
          (error) => error.status === 404,
        );
        await tx.shop.update({
          where: { id: shopB.id },
          data: { isActive: true },
        });
        await tx.user.update({
          where: { id: userA.id },
          data: { isActive: false },
        });
        await assert.rejects(
          memberships.requireMembership(userA.id, shopB.id),
          (error) => error.status === 404,
        );
        await tx.user.update({
          where: { id: userA.id },
          data: { isActive: true },
        });

        await tx.shopMember.delete({
          where: { userId_shopId: { userId: userA.id, shopId: shopB.id } },
        });
        await assert.rejects(
          memberships.requireMembership(userA.id, shopB.id),
          (error) => error.status === 404,
        );
        await tx.shop.delete({ where: { id: shopA.id } });
        assert.equal(
          await tx.shopMember.count({ where: { shopId: shopA.id } }),
          0,
        );
        await tx.user.delete({ where: { id: userB.id } });
        assert.equal(
          await tx.shopMember.count({ where: { userId: userB.id } }),
          0,
        );
        assert.equal(await tx.shop.count({ where: { id: shopB.id } }), 1);
        throw rollback;
      },
      { timeout: 30000, maxWait: 10000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(
    await prisma.user.count({ where: { email: { in: emails } } }),
    0,
  );
  assert.equal(
    await prisma.shop.count({
      where: {
        name: {
          in: [
            `Member A ${fixtureKey}`,
            `Member B ${fixtureKey}`,
            `Member C ${fixtureKey}`,
          ],
        },
      },
    }),
    0,
  );
  console.log(
    'Verified automatic OWNER association, no global User role or account mutation, independent staff roles, isolation, duplicate/foreign-key protection, live changes, and cascade cleanup. No fixtures retained.',
  );
} finally {
  await prisma.$disconnect();
}
