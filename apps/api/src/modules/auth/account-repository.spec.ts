import { Test } from '@nestjs/testing';
import { AuthRepository } from './auth.repository.js';
import { PrismaService } from '../../database/prisma.service.js';

describe('Atomic account updates', () => {
  const tx = {
    user: { updateMany: vi.fn() },
    authSession: { updateMany: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
    user: { update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  };
  let repository: AuthRepository;
  beforeEach(async () => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (db: typeof tx) => unknown) => callback(tx),
    );
    const module = await Test.createTestingModule({
      providers: [AuthRepository, { provide: PrismaService, useValue: prisma }],
    }).compile();
    repository = module.get(AuthRepository);
  });
  it('ignores duplicate registration atomically without overwriting existing credentials', async () => {
    prisma.user.createMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.createAccount('owner@example.com', 'new-hash'),
    ).resolves.toEqual({ count: 0 });
    expect(prisma.user.createMany).toHaveBeenCalledWith({
      data: { email: 'owner@example.com', passwordHash: 'new-hash' },
      skipDuplicates: true,
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('conditions credential writes on the live identity, session and verified hash, then revokes every session atomically', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    await repository.changeCredentials('self', 'session', 'verified-hash', {
      passwordHash: 'new-hash',
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'self',
        isActive: true,
        passwordHash: 'verified-hash',
        sessions: {
          some: {
            id: 'session',
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          },
        },
      },
      data: { passwordHash: 'new-hash' },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'self', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
  it('rejects a raced or revoked write without performing session updates', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.changeCredentials('self', 'session', 'old-hash', {
        email: 'new@example.com',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });
  it('does not accept inactive or revoked profile writes and explicitly allows only names', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.updateProfile('self', 'session', {
        firstName: '',
        lastName: 'Name',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { firstName: null, lastName: 'Name' },
        where: expect.objectContaining({
          id: 'self',
          isActive: true,
          sessions: {
            some: expect.objectContaining({ id: 'session', revokedAt: null }),
          },
        }),
      }),
    );
  });
  it('rechecks the verified password when a concurrent login creates its session', async () => {
    const expiresAt = new Date();
    await repository.createSession(
      'session',
      'self',
      'refresh-hash',
      expiresAt,
      'verified-hash',
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'self', isActive: true, passwordHash: 'verified-hash' },
      data: {
        updatedAt: expect.any(Date),
        sessions: {
          create: {
            id: 'session',
            refreshTokenHash: 'refresh-hash',
            expiresAt,
          },
        },
      },
      select: { id: true },
    });
  });
});
