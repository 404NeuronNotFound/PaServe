// Real PostgreSQL + Argon2 acceptance smoke test. Every fixture is rolled back.
// This checks gross timing discrepancies; it does not prove constant-time network behavior.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../dist/database/prisma.service.js';
import { AuthRepository } from '../dist/modules/auth/auth.repository.js';
import { AuthService } from '../dist/modules/auth/auth.service.js';

const prisma = new PrismaService();
const marker = randomUUID();
const email = `abuse-${marker}@example.invalid`;
const password = 'Disposable acceptance fixture passphrase';
const rollback = new Error('Intentional login-abuse acceptance rollback');
let report;
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) =>
    Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100;
  return {
    samples: sorted.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
  };
};
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const auth = new AuthService(new AuthRepository(tx), {});
        const acknowledgement = await auth.register({ email, password });
        const before = await tx.user.findUniqueOrThrow({ where: { email } });
        const missing = `missing-${marker}@example.invalid`;
        const timings = {
          knownWrong: [],
          unknown: [],
          duplicateRegistration: [],
          newRegistration: [],
        };
        const failure = async (target) => {
          await assert.rejects(
            auth.login({
              email: target,
              password: 'incorrect fixture password',
            }),
            (error) => {
              assert.equal(error.status, 401);
              assert.equal(error.response.code, 'INVALID_CREDENTIALS');
              assert.equal(
                error.response.message,
                'Email or password is incorrect, or the account is unavailable.',
              );
              return true;
            },
          );
        };
        await failure(email);
        await failure(missing);
        const measure = async (name, work) => {
          const started = performance.now();
          await work();
          timings[name].push(performance.now() - started);
        };
        // Alternate the order to reduce warm-up and drift bias; run serially to avoid
        // measuring competing password jobs or changing the production admission limits.
        for (let i = 0; i < 16; i++) {
          const pair =
            i % 2
              ? [
                  ['unknown', missing],
                  ['knownWrong', email],
                ]
              : [
                  ['knownWrong', email],
                  ['unknown', missing],
                ];
          for (const [name, target] of pair)
            await measure(name, () => failure(target));
        }
        const afterFailures = await tx.user.findUniqueOrThrow({
          where: { email },
        });
        assert.deepEqual(afterFailures, before);
        assert.equal(
          await tx.authSession.count({ where: { userId: before.id } }),
          0,
        );
        for (let i = 0; i < 16; i++) {
          const pair =
            i % 2
              ? ['newRegistration', 'duplicateRegistration']
              : ['duplicateRegistration', 'newRegistration'];
          for (const name of pair)
            await measure(name, async () => {
              const result = await auth.register({
                email:
                  name === 'duplicateRegistration'
                    ? email.toUpperCase()
                    : `new-${i}-${marker}@example.invalid`,
                password,
              });
              assert.deepEqual(result, acknowledgement);
            });
        }
        const afterRegistration = await tx.user.findUniqueOrThrow({
          where: { email },
        });
        assert.deepEqual(afterRegistration, before);
        const metrics = Object.fromEntries(
          Object.entries(timings).map(([name, values]) => [
            name,
            summarize(values),
          ]),
        );
        const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);
        const loginMedianRatio = ratio(
          metrics.knownWrong.p50Ms,
          metrics.unknown.p50Ms,
        );
        const registrationMedianRatio = ratio(
          metrics.duplicateRegistration.p50Ms,
          metrics.newRegistration.p50Ms,
        );
        report = {
          environment: 'local-api-configured-postgresql-rollback-only',
          metrics,
          loginMedianRatio,
          registrationMedianRatio,
          maximumMedianRatio: 2,
          failedLoginsCreateSessions: false,
          failedLoginsMutateAccount: false,
          duplicateRegistrationMutatesAccount: false,
          fixturesRolledBack: true,
        };
        assert.ok(
          loginMedianRatio <= 2,
          'Investigate login timing discrepancy',
        );
        assert.ok(
          registrationMedianRatio <= 2,
          'Investigate registration timing discrepancy',
        );
        throw rollback;
      },
      { timeout: 120_000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(
    await prisma.user.count({ where: { email: { contains: marker } } }),
    0,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await prisma.$disconnect();
}
