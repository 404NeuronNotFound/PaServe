import { Test } from '@nestjs/testing';
import { REGISTRATION_ACKNOWLEDGEMENT } from '@paserve/contracts';
import { verify } from 'argon2';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { TokensService } from './tokens.service.js';
import { PasswordHashService } from './password-hash.service.js';
import { ConfigService } from '@nestjs/config';

describe('AuthService registration', () => {
  const repository = { findAccountByEmail: vi.fn(), createAccount: vi.fn() };
  let service: AuthService;

  beforeEach(async () => {
    vi.resetAllMocks();
    repository.findAccountByEmail.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        PasswordHashService,
        ConfigService,
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
    expect(result).toEqual({ message: REGISTRATION_ACKNOWLEDGEMENT });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain('passwordHash');
  });

  it('hashes and returns the same acknowledgement when the conflict-safe insert creates nothing', async () => {
    repository.createAccount.mockResolvedValue({ count: 0 });
    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).resolves.toEqual({ message: REGISTRATION_ACKNOWLEDGEMENT });
    expect(repository.createAccount).toHaveBeenCalledWith(
      'owner@example.com',
      expect.stringMatching(/^\$argon2id\$/),
    );
    expect(repository.findAccountByEmail).not.toHaveBeenCalled();
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
