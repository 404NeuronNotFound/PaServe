import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { verify } from 'argon2';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TokensService } from './tokens.service.js';

describe('AuthService registration', () => {
  const repository = { findAccountByEmail: vi.fn(), createAccount: vi.fn() };
  let service: AuthService;

  beforeEach(async () => {
    vi.resetAllMocks();
    repository.findAccountByEmail.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repository },
        { provide: TokensService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('normalizes email, stores a verifiable Argon2id hash, and returns only safe fields', async () => {
    const password = 'a long passphrase for testing';
    repository.createAccount.mockImplementation(
      async (email: string, passwordHash: string) => {
        expect(email).toBe('owner@example.com');
        expect(passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(await verify(passwordHash, password)).toBe(true);
        return {
          id: 'user-id',
          email,
          createdAt: new Date('2026-10-08T00:00:00Z'),
          passwordHash,
        };
      },
    );
    const result = await service.register({
      email: ' Owner@Example.com ',
      password,
    });
    expect(result).toEqual({
      user: {
        id: 'user-id',
        email: 'owner@example.com',
        createdAt: '2026-10-08T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('rejects an existing email before creating an account', async () => {
    repository.findAccountByEmail.mockResolvedValue({ id: 'existing-user' });
    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createAccount).not.toHaveBeenCalled();
  });

  it('maps a concurrent database unique violation to 409', async () => {
    repository.createAccount.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).rejects.toMatchObject({
      response: { code: 'EMAIL_ALREADY_EXISTS' },
      status: 409,
    });
  });

  it('preserves unrelated failures for generic error handling', async () => {
    repository.createAccount.mockRejectedValue(
      new Error('Database unavailable'),
    );
    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).rejects.toThrow('Database unavailable');
  });
});
