import { createHash } from 'node:crypto';
import { EmailChangeService } from './email-change.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { TokensService } from './tokens.service.js';
import type { PasswordHashService } from './password-hash.service.js';
import type { IdentityService } from './identity.service.js';
const account = {
  id: 'self',
  email: 'old@example.com',
  passwordHash: 'hash',
  googleSubject: null as string | null,
};
const pending = () => ({
  id: 'pending',
  userId: 'self',
  oldEmail: account.email,
  newEmail: 'new@example.com',
  credentialStamp: createHash('sha256').update('hash').digest('hex'),
  expiresAt: new Date(Date.now() + 900000),
  resendAt: new Date(0),
  attempts: 0,
  currentConfirmed: false,
  newConfirmed: false,
});
const prisma = {
  pendingEmailChange: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  user: { updateMany: vi.fn() },
  authSession: { updateMany: vi.fn() },
  $transaction: vi.fn(),
};
const repository = {
  findCredentialAccount: vi.fn(),
  findAccountByEmail: vi.fn(),
};
const tokens = { verify: vi.fn() };
const passwords = { verify: vi.fn() };
const identity = {
  verifyGoogle: vi.fn(),
  sendCode: vi.fn(),
  verifyEmail: vi.fn(),
};
let service: EmailChangeService;
beforeEach(() => {
  vi.resetAllMocks();
  account.googleSubject = null;
  tokens.verify.mockResolvedValue({ sub: 'self', sid: 'session' });
  repository.findCredentialAccount.mockResolvedValue(account);
  repository.findAccountByEmail.mockResolvedValue(null);
  passwords.verify.mockResolvedValue(true);
  prisma.pendingEmailChange.findUnique.mockResolvedValue(pending());
  prisma.pendingEmailChange.create.mockResolvedValue(pending());
  prisma.pendingEmailChange.updateMany.mockResolvedValue({ count: 1 });
  prisma.pendingEmailChange.deleteMany.mockResolvedValue({ count: 1 });
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
  service = new EmailChangeService(
    prisma as unknown as PrismaService,
    repository as unknown as AuthRepository,
    tokens as unknown as TokensService,
    passwords as unknown as PasswordHashService,
    identity as unknown as IdentityService,
  );
});
it('keeps current email and sessions active when requesting verification, and only sends to the current inbox', async () => {
  await service.start('access', {
    email: ' NEW@Example.com ',
    currentPassword: 'password',
  });
  expect(identity.sendCode).toHaveBeenCalledExactlyOnceWith(account.email);
  expect(prisma.pendingEmailChange.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        newEmail: 'new@example.com',
        userId: 'self',
      }),
    }),
  );
  expect(prisma.user.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { updatedAt: expect.any(Date) } }),
  );
  expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
});
it('requires current password or the exact linked Google subject before creating a request', async () => {
  passwords.verify.mockResolvedValue(false);
  await expect(
    service.start('access', {
      email: 'new@example.com',
      currentPassword: 'bad',
    }),
  ).rejects.toMatchObject({ status: 400 });
  account.googleSubject = 'linked';
  identity.verifyGoogle.mockResolvedValue({ subject: 'someone-else' });
  await expect(
    service.start(
      'access',
      { email: 'new@example.com', credential: 'google' },
      'nonce',
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(prisma.$transaction).not.toHaveBeenCalled();
  identity.verifyGoogle.mockResolvedValue({ subject: 'linked' });
  await service.start(
    'access',
    { email: 'new@example.com', credential: 'google' },
    'nonce',
  );
  expect(identity.verifyGoogle).toHaveBeenCalledWith('google', 'nonce');
});
it('verifies the current inbox before sending to the new inbox, without changing credentials', async () => {
  await service.confirm('access', {
    id: 'pending',
    target: 'current',
    code: '123456',
  });
  expect(identity.verifyEmail).toHaveBeenCalledWith(account.email, '123456');
  expect(identity.sendCode).toHaveBeenCalledWith('new@example.com');
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
  expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
});
it('rejects new inbox approval before current approval and rejects expired or foreign request IDs', async () => {
  await expect(
    service.confirm('access', { id: 'pending', target: 'new', code: '123456' }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.confirm('access', {
      id: 'other',
      target: 'current',
      code: '123456',
    }),
  ).rejects.toMatchObject({ status: 400 });
  prisma.pendingEmailChange.findUnique.mockResolvedValue({
    ...pending(),
    expiresAt: new Date(0),
  });
  await expect(
    service.confirm('access', {
      id: 'pending',
      target: 'current',
      code: '123456',
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(identity.verifyEmail).not.toHaveBeenCalled();
});
it('atomically updates verified email and revokes all sessions after new inbox approval', async () => {
  prisma.pendingEmailChange.findUnique.mockResolvedValue({
    ...pending(),
    currentConfirmed: true,
  });
  await expect(
    service.confirm('access', { id: 'pending', target: 'new', code: '654321' }),
  ).resolves.toEqual({ completed: true, pending: null });
  expect(identity.verifyEmail).toHaveBeenCalledWith(
    'new@example.com',
    '654321',
  );
  expect(prisma.user.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: 'self',
        email: account.email,
        passwordHash: 'hash',
      }),
      data: {
        email: 'new@example.com',
        emailVerifiedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    }),
  );
  expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
    where: { userId: 'self', revokedAt: null },
    data: { revokedAt: expect.any(Date) },
  });
});
it('does not update email when the OTP fails or cancellation wins the final claim', async () => {
  prisma.pendingEmailChange.findUnique.mockResolvedValue({
    ...pending(),
    currentConfirmed: true,
  });
  identity.verifyEmail.mockRejectedValueOnce(new Error('invalid OTP'));
  await expect(
    service.confirm('access', { id: 'pending', target: 'new', code: 'bad' }),
  ).rejects.toThrow('invalid OTP');
  prisma.pendingEmailChange.deleteMany.mockResolvedValue({ count: 0 });
  await expect(
    service.confirm('access', { id: 'pending', target: 'new', code: '123456' }),
  ).rejects.toMatchObject({ status: 400 });
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
});
it('bounds attempts and reserves the resend cooldown before provider calls', async () => {
  prisma.pendingEmailChange.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    service.resend('access', { id: 'pending', target: 'current' }),
  ).rejects.toMatchObject({ status: 429 });
  expect(identity.sendCode).not.toHaveBeenCalled();
  prisma.pendingEmailChange.findUnique.mockResolvedValue({
    ...pending(),
    attempts: 10,
  });
  await expect(
    service.confirm('access', {
      id: 'pending',
      target: 'current',
      code: '123456',
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(identity.verifyEmail).not.toHaveBeenCalled();
});
it('cancels only the authenticated users request and never changes their credentials', async () => {
  await service.cancel('access', 'pending');
  expect(prisma.pendingEmailChange.deleteMany).toHaveBeenCalledWith({
    where: { id: 'pending', userId: 'self' },
  });
  expect(prisma.user.updateMany).not.toHaveBeenCalled();
});
it('preserves the pending request and current identity when delivery fails', async () => {
  identity.sendCode.mockRejectedValue(new Error('SMTP unavailable'));
  await expect(
    service.start('access', {
      email: 'new@example.com',
      currentPassword: 'password',
    }),
  ).rejects.toThrow('SMTP unavailable');
  expect(prisma.pendingEmailChange.create).toHaveBeenCalled();
  expect(prisma.authSession.updateMany).not.toHaveBeenCalled();
});
