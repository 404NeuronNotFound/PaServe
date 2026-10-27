// Phase 1: real authentication services and configured PostgreSQL schema.
// All accounts and sessions created by this check roll back.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { verify } from 'argon2';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../dist/database/prisma.service.js';
import { AuthRepository } from '../dist/modules/auth/auth.repository.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';
import { TokensService } from '../dist/modules/auth/tokens.service.js';

const prisma = new PrismaService();
const email = `auth-audit-${randomUUID()}@example.invalid`;
const password = 'Audit fixture passphrase, not a real credential';
const rollback = new Error('Intentional authentication fixture rollback');
const invalidSession = (error) => error.status === 401;
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const auth = new AuthService(
          new AuthRepository(tx),
          new TokensService(new JwtService(), new ConfigService()),
        );
        const registered = await auth.register({
          email: ` ${email.toUpperCase()} `,
          password,
        });
        assert.deepEqual(Object.keys(registered), ['message']);
        const account = await tx.user.findUniqueOrThrow({
          where: { email },
        });
        assert.match(account.passwordHash, /^\$argon2id\$/);
        assert.equal(await verify(account.passwordHash, password), true);
        assert.deepEqual(
          await auth.register({
            email: email.toUpperCase(),
            password: 'a different submitted password',
          }),
          registered,
        );
        const unchanged = await tx.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        assert.equal(unchanged.passwordHash, account.passwordHash);
        await assert.rejects(
          auth.login({ email, password: 'incorrect password' }),
          invalidSession,
        );
        const login = await auth.login({ email, password });
        const current = await auth.currentUser(login.response.accessToken);
        assert.equal(current.id, account.id);
        assert.equal('passwordHash' in current, false);
        const rotated = await auth.refresh(login.refreshToken);
        assert.notEqual(rotated.refreshToken, login.refreshToken);
        await assert.rejects(auth.refresh(login.refreshToken), invalidSession);
        await assert.rejects(
          auth.refresh(rotated.refreshToken),
          invalidSession,
        );
        await assert.rejects(
          auth.currentUser(rotated.response.accessToken),
          invalidSession,
        );

        const second = await auth.login({ email, password });
        const concurrent = await Promise.allSettled([
          auth.refresh(second.refreshToken),
          auth.refresh(second.refreshToken),
        ]);
        assert.equal(
          concurrent.filter((value) => value.status === 'fulfilled').length,
          1,
        );
        const winner = concurrent.find(
          (value) => value.status === 'fulfilled',
        ).value;
        await assert.rejects(
          auth.currentUser(winner.response.accessToken),
          invalidSession,
        );
        await assert.rejects(auth.refresh(winner.refreshToken), invalidSession);

        const third = await auth.login({ email, password });
        await auth.logout(third.refreshToken);
        await assert.rejects(
          auth.currentUser(third.response.accessToken),
          invalidSession,
        );
        await assert.rejects(auth.refresh(third.refreshToken), invalidSession);
        const fourth = await auth.login({ email, password });
        await tx.user.update({
          where: { id: account.id },
          data: { isActive: false },
        });
        await assert.rejects(
          auth.currentUser(fourth.response.accessToken),
          invalidSession,
        );
        await assert.rejects(auth.refresh(fourth.refreshToken), invalidSession);
        for (const name of ['users', 'auth_sessions']) {
          const [security] = await tx.$queryRaw`
          SELECT relrowsecurity AS rls,
            has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
            has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS browser_access
          FROM pg_class WHERE oid = ${name}::regclass`;
          assert.deepEqual(security, {
            rls: true,
            anon_access: false,
            browser_access: false,
          });
        }
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Authentication PostgreSQL checks passed: normalized registration, Argon2id hashing, duplicate acknowledgement with unchanged credentials, wrong-password denial, rotation/replay and concurrent reuse revocation, logout, inactive accounts, safe profiles and RLS. All fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
