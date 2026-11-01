import { PasswordRecoveryService } from './password-recovery.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { IdentityService } from './identity.service.js';
import type { PasswordHashService } from './password-hash.service.js';

function setup() {
  const account = {
    id: 'user-1',
    email: 'owner@example.com',
    passwordHash: 'old-hash',
    isActive: true,
    googleSubject: null as string | null,
  };
  const tx = {
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    authSession: { updateMany: vi.fn() },
    pendingEmailChange: { deleteMany: vi.fn() },
  };
  const prisma = {
    user: {
      findFirst: vi
        .fn<(...args: unknown[]) => Promise<typeof account | null>>()
        .mockResolvedValue(account),
    },
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const identity = { verifyRecoveryCode: vi.fn().mockResolvedValue(undefined) };
  const passwords = { hash: vi.fn().mockResolvedValue('new-hash') };
  const service = new PasswordRecoveryService(
    prisma as unknown as PrismaService,
    identity as unknown as IdentityService,
    passwords as unknown as PasswordHashService,
  );
  return { account, tx, prisma, identity, passwords, service };
}
const input = {
  email: 'Owner@Example.com',
  code: '123456',
  password: 'new long passphrase',
};

it('verifies recovery proof, conditionally changes credentials and revokes sessions in one transaction', async () => {
  const f = setup();
  await f.service.reset(input);
  expect(f.identity.verifyRecoveryCode).toHaveBeenCalledWith(
    'owner@example.com',
    '123456',
  );
  expect(f.tx.user.updateMany).toHaveBeenCalledWith({
    where: {
      id: 'user-1',
      email: 'owner@example.com',
      passwordHash: 'old-hash',
      isActive: true,
      googleSubject: null,
    },
    data: { passwordHash: 'new-hash', emailVerifiedAt: expect.any(Date) },
  });
  expect(f.tx.authSession.updateMany).toHaveBeenCalledWith({
    where: { userId: 'user-1', revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
  expect(f.tx.pendingEmailChange.deleteMany).toHaveBeenCalledWith({
    where: { userId: 'user-1' },
  });
});
it('does not hash or mutate credentials without valid recovery proof', async () => {
  const f = setup();
  f.identity.verifyRecoveryCode.mockRejectedValue(
    new Error('invalid recovery'),
  );
  await expect(f.service.reset(input)).rejects.toThrow();
  expect(f.passwords.hash).not.toHaveBeenCalled();
  expect(f.prisma.$transaction).not.toHaveBeenCalled();
});
it.each(['missing', 'disabled', 'google'])(
  'cannot reset a %s account',
  async (kind) => {
    const f = setup();
    f.prisma.user.findFirst.mockResolvedValue(
      kind === 'missing'
        ? null
        : {
            ...f.account,
            isActive: kind !== 'disabled',
            googleSubject: kind === 'google' ? 'google-subject' : null,
          },
    );
    await expect(f.service.reset(input)).rejects.toThrow('reset code');
    expect(f.passwords.hash).not.toHaveBeenCalled();
  },
);
it('rejects a concurrent email or password change before revoking sessions', async () => {
  const f = setup();
  f.tx.user.updateMany.mockResolvedValue({ count: 0 });
  await expect(f.service.reset(input)).rejects.toThrow('reset code');
  expect(f.tx.authSession.updateMany).not.toHaveBeenCalled();
});
