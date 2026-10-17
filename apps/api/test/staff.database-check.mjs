import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { StaffService } from '../dist/modules/staff/staff.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import {
  SHOP_OPERATIONAL_PERMISSIONS,
  SHOP_CASHIER_PERMISSIONS,
  SHOP_KITCHEN_PERMISSIONS,
} from '@paserve/contracts';

// Only disposable schema objects and fixtures are committed; public data and
// migration history are untouched. Always settle sessions before cleanup.
const schema = `staff_check_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^staff_check_[0-9a-f]{32}$/);
const q = (name) => `"${schema}"."${name}"`;
const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;
let prisma;
try {
  await setup.connect();
  await setup.query('BEGIN');
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(
    `CREATE TYPE ${q('ShopRole')} AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'KITCHEN')`,
  );
  await setup.query(`CREATE TABLE ${q('users')} (
    "id" TEXT PRIMARY KEY, "email" TEXT UNIQUE NOT NULL,
    "passwordHash" TEXT NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
    "firstName" TEXT, "lastName" TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await setup.query(`CREATE TABLE ${q('shops')} (
    "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "slug" TEXT UNIQUE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true, "logoUrl" TEXT)`);
  await setup.query(`CREATE TABLE ${q('shop_members')} (
    "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES ${q('users')}(id),
    "shopId" TEXT NOT NULL REFERENCES ${q('shops')}(id), "role" ${q('ShopRole')} NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("userId", "shopId"))`);
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261013010000_staff_invitations/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await setup.query(
    sql
      .replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '')
      .replace(
        /"(shops|staff_invitations|staff_audit_events|ShopRole)"/g,
        (_match, name) => q(name),
      ),
  );
  const ownerId = randomUUID();
  const userId = randomUUID();
  const otherUser = randomUUID();
  const shopId = randomUUID();
  const otherShop = randomUUID();
  for (const [id, email] of [
    [ownerId, 'owner@example.com'],
    [userId, 'cashier@example.com'],
    [otherUser, 'other@example.com'],
  ])
    await setup.query(
      `INSERT INTO ${q('users')} (id, email, "passwordHash") VALUES ($1, $2, 'unused')`,
      [id, email],
    );
  for (const id of [shopId, otherShop])
    await setup.query(
      `INSERT INTO ${q('shops')} (id, name, slug) VALUES ($1, 'Test shop', $1)`,
      [id],
    );
  for (const id of [shopId, otherShop])
    await setup.query(
      `INSERT INTO ${q('shop_members')} (id, "userId", "shopId", role) VALUES ($1, $2, $3, 'OWNER')`,
      [randomUUID(), ownerId, id],
    );
  await setup.query('COMMIT');
  created = true;
  prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        max: 4,
        options: `-c search_path=${schema}`,
      },
      { schema },
    ),
  });
  const staff = new StaffService(prisma);
  const ownerMembership = await prisma.shopMember.findUnique({
    where: { userId_shopId: { userId: ownerId, shopId } },
  });
  const protectedOutcomes = await Promise.allSettled([
    staff.remove(ownerId, shopId, ownerMembership.id),
    staff.changeRole(ownerId, shopId, ownerMembership.id, { role: 'ADMIN' }),
  ]);
  for (const outcome of protectedOutcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.status, 403);
    assert.equal(outcome.reason.response.code, 'OWNER_PROTECTED');
  }
  const protectedOwner = await prisma.shopMember.findUnique({
    where: { id: ownerMembership.id },
  });
  assert.equal(protectedOwner.role, 'OWNER');
  assert.equal(
    await prisma.shopMember.count({ where: { shopId, role: 'OWNER' } }),
    1,
  );
  assert.equal(await prisma.staffAuditEvent.count({ where: { shopId } }), 0);
  const invitation = await staff.invite(ownerId, shopId, {
    email: 'cashier@example.com',
    role: 'CASHIER',
  });
  const stored = await prisma.staffInvitation.findUnique({
    where: { id: invitation.invitation.id },
  });
  const preview = await staff.preview(userId, shopId, invitation.token);
  assert.equal(preview.shopName, 'Test shop');
  assert.equal(preview.role, 'CASHIER');
  assert.equal(await prisma.shopMember.count({ where: { shopId, userId } }), 0);
  assert.notEqual(stored.tokenHash, invitation.token);
  assert.equal(stored.tokenHash.length, 64);
  await assert.rejects(staff.accept(otherUser, shopId, invitation.token), {
    status: 403,
  });
  await assert.rejects(staff.accept(userId, otherShop, invitation.token), {
    status: 404,
  });
  // Exactly one concurrent acceptance succeeds; the consumed token is rejected.
  const outcomes = await Promise.allSettled([
    staff.accept(userId, shopId, invitation.token),
    staff.accept(userId, shopId, invitation.token),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 404);
  assert.equal(await prisma.shopMember.count({ where: { shopId, userId } }), 1);
  assert.equal(
    await prisma.staffAuditEvent.count({
      where: { shopId, action: 'ACCEPTED' },
    }),
    1,
  );
  await assert.rejects(staff.preview(userId, shopId, invitation.token), {
    status: 404,
  });
  await assert.rejects(staff.accept(userId, shopId, invitation.token), {
    status: 404,
  });
  const member = await prisma.shopMember.findUnique({
    where: { userId_shopId: { userId, shopId } },
  });
  const access = new ShopMembersService(new ShopMembersRepository(prisma));
  const otherMembership = await prisma.shopMember.create({
    data: { userId, shopId: otherShop, role: 'CASHIER' },
  });
  await staff.changeRole(ownerId, shopId, member.id, { role: 'ADMIN' });
  assert.equal(
    (await access.requirePermission(userId, shopId, 'shop.operations.manage'))
      .role,
    'ADMIN',
  );
  for (const permission of [
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ])
    await assert.rejects(access.requirePermission(userId, shopId, permission), {
      status: 403,
    });
  await assert.rejects(
    staff.changeRole(userId, shopId, ownerMembership.id, { role: 'CASHIER' }),
    { status: 403 },
  );
  await assert.rejects(
    staff.changeRole(ownerId, otherShop, member.id, { role: 'ADMIN' }),
    { status: 404 },
  );
  await setup.query(
    `ALTER TABLE ${q('staff_audit_events')} ADD CONSTRAINT test_role_audit_failure CHECK (action <> 'ROLE_CHANGED') NOT VALID`,
  );
  await assert.rejects(
    staff.changeRole(ownerId, shopId, member.id, { role: 'CASHIER' }),
  );
  assert.equal(
    (await prisma.shopMember.findUnique({ where: { id: member.id } })).role,
    'ADMIN',
  );
  await setup.query(
    `ALTER TABLE ${q('staff_audit_events')} DROP CONSTRAINT test_role_audit_failure`,
  );
  await staff.changeRole(ownerId, shopId, member.id, { role: 'CASHIER' });
  await assert.rejects(
    access.requirePermission(userId, shopId, 'shop.operations.manage'),
    { status: 403 },
  );
  assert.equal((await access.requireMembership(userId, shopId)).id, member.id);
  assert.equal(
    (await prisma.shopMember.findUnique({ where: { id: otherMembership.id } }))
      .role,
    'CASHIER',
  );
  await staff.changeRole(ownerId, shopId, member.id, { role: 'MANAGER' });
  for (const permission of [
    ...SHOP_OPERATIONAL_PERMISSIONS,
    ...SHOP_CASHIER_PERMISSIONS,
    ...SHOP_KITCHEN_PERMISSIONS,
  ])
    assert.equal(
      (await access.requirePermission(userId, shopId, permission)).role,
      'MANAGER',
    );
  for (const permission of [
    'shop.operations.manage',
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ])
    await assert.rejects(access.requirePermission(userId, shopId, permission), {
      status: 403,
    });
  await assert.rejects(
    access.requirePermission(userId, otherShop, 'shop.menu.manage'),
    { status: 403 },
  );
  await assert.rejects(
    staff.changeRole(userId, shopId, member.id, { role: 'ADMIN' }),
    { status: 403 },
  );
  await staff.changeRole(ownerId, shopId, member.id, { role: 'CASHIER' });
  for (const permission of SHOP_OPERATIONAL_PERMISSIONS)
    await assert.rejects(access.requirePermission(userId, shopId, permission), {
      status: 403,
    });
  assert.equal((await access.requireMembership(userId, shopId)).id, member.id);
  assert.equal(
    (await prisma.shopMember.findUnique({ where: { id: otherMembership.id } }))
      .role,
    'CASHIER',
  );
  const roleEvents = await prisma.staffAuditEvent.findMany({
    where: { shopId, action: 'ROLE_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(
    roleEvents.map(({ previousRole, role }) => [previousRole, role]),
    [
      ['CASHIER', 'ADMIN'],
      ['ADMIN', 'CASHIER'],
      ['CASHIER', 'MANAGER'],
      ['MANAGER', 'CASHIER'],
    ],
  );
  for (const permission of SHOP_CASHIER_PERMISSIONS)
    assert.equal(
      (await access.requirePermission(userId, shopId, permission)).role,
      'CASHIER',
    );
  for (const permission of [
    ...SHOP_OPERATIONAL_PERMISSIONS,
    ...SHOP_KITCHEN_PERMISSIONS,
    'shop.operations.manage',
    'shop.settings.manage',
    'shop.ownership.manage',
    'shop.billing.manage',
  ])
    await assert.rejects(access.requirePermission(userId, shopId, permission), {
      status: 403,
    });
  await staff.changeRole(ownerId, otherShop, otherMembership.id, {
    role: 'KITCHEN',
  });
  for (const permission of SHOP_CASHIER_PERMISSIONS)
    await assert.rejects(
      access.requirePermission(userId, otherShop, permission),
      { status: 403 },
    );
  await assert.rejects(
    staff.changeRole(userId, shopId, member.id, { role: 'MANAGER' }),
    { status: 403 },
  );
  await staff.changeRole(ownerId, shopId, member.id, { role: 'KITCHEN' });
  for (const permission of SHOP_CASHIER_PERMISSIONS)
    await assert.rejects(access.requirePermission(userId, shopId, permission), {
      status: 403,
    });
  await staff.changeRole(ownerId, shopId, member.id, { role: 'CASHIER' });
  assert.equal((await access.requireMembership(userId, shopId)).id, member.id);
  assert.equal(
    (await prisma.shopMember.findUnique({ where: { id: otherMembership.id } }))
      .role,
    'KITCHEN',
  );
  const cashierTransitions = await prisma.staffAuditEvent.findMany({
    where: { shopId, action: 'ROLE_CHANGED' },
    orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(
    cashierTransitions
      .slice(-2)
      .map(({ previousRole, role }) => [previousRole, role]),
    [
      ['CASHIER', 'KITCHEN'],
      ['KITCHEN', 'CASHIER'],
    ],
  );
  await assert.rejects(
    staff.invite(ownerId, shopId, {
      email: 'cashier@example.com',
      role: 'KITCHEN',
    }),
    { status: 409 },
  );
  await staff.changeRole(ownerId, shopId, member.id, { role: 'KITCHEN' });
  await assert.rejects(staff.accept(userId, shopId, invitation.token), {
    status: 404,
  });
  await assert.rejects(staff.list(userId, shopId), { status: 403 });
  const resources = new TenantResourcesRepository(prisma);
  assert.equal(
    (
      await resources.findResource(
        ownerId,
        shopId,
        'staffInvitation',
        stored.id,
      )
    ).id,
    stored.id,
  );
  assert.equal(
    await resources.findResource(
      ownerId,
      otherShop,
      'staffInvitation',
      stored.id,
    ),
    null,
  );
  assert.equal(
    await resources.findResource(userId, shopId, 'staffInvitation', stored.id),
    null,
  );
  await staff.remove(ownerId, shopId, member.id);
  await assert.rejects(staff.accept(userId, shopId, invitation.token), {
    status: 404,
  });
  assert.ok(await prisma.user.findUnique({ where: { id: userId } }));
  const first = await staff.invite(ownerId, shopId, {
    email: 'cashier@example.com',
    role: 'CASHIER',
  });
  const replacement = await staff.invite(ownerId, shopId, {
    email: 'cashier@example.com',
    role: 'KITCHEN',
  });
  await assert.rejects(staff.accept(userId, shopId, first.token), {
    status: 404,
  });
  await staff.revoke(ownerId, shopId, replacement.invitation.id);
  await assert.rejects(staff.accept(userId, shopId, replacement.token), {
    status: 404,
  });
  const expired = await staff.invite(ownerId, shopId, {
    email: 'cashier@example.com',
    role: 'CASHIER',
  });
  await prisma.staffInvitation.update({
    where: { id: expired.invitation.id },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(staff.accept(userId, shopId, expired.token), {
    status: 404,
  });
  // Force an audit failure: neither membership insertion nor token consumption
  // may survive a failed acceptance transaction.
  const atomic = await staff.invite(ownerId, shopId, {
    email: 'cashier@example.com',
    role: 'CASHIER',
  });
  await setup.query(
    `ALTER TABLE ${q('staff_audit_events')} ADD CONSTRAINT test_acceptance_failure CHECK (action <> 'ACCEPTED') NOT VALID`,
  );
  await assert.rejects(staff.accept(userId, shopId, atomic.token));
  assert.equal(await prisma.shopMember.count({ where: { shopId, userId } }), 0);
  assert.equal(
    (
      await prisma.staffInvitation.findUnique({
        where: { id: atomic.invitation.id },
      })
    ).acceptedAt,
    null,
  );
  await setup.query(
    `ALTER TABLE ${q('staff_audit_events')} DROP CONSTRAINT test_acceptance_failure`,
  );
  await staff.accept(userId, shopId, atomic.token);
  for (const name of ['staff_invitations', 'staff_audit_events']) {
    const result = await setup.query(
      `SELECT relrowsecurity AS rls,
      has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
      FROM pg_class WHERE oid = $1::regclass`,
      [`${schema}.${name}`],
    );
    assert.deepEqual(result.rows[0], {
      rls: true,
      anon_access: false,
      browser_access: false,
    });
  }
  console.log(
    'Passed: migration, invitations, tenant isolation, concurrent acceptance, owner protection, admin/manager/cashier assignment and revocation, live permission removal, audit rollback and RLS.',
  );
} finally {
  if (prisma) await prisma.$disconnect();
  if (!created) await setup.query('ROLLBACK').catch(() => undefined);
  if (created) {
    await setup.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log('Removed isolated staff test schema.');
  }
  await setup.end();
}
