import { Test } from '@nestjs/testing';
import { REGISTRATION_ACKNOWLEDGEMENT } from '@paserve/contracts';
import { verify } from 'argon2';
import { IdentityService } from './identity.service.js';
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
        {
          provide: IdentityService,
          useValue: { verifyEmail: vi.fn().mockResolvedValue(undefined) },
        },
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
      firstName: ' Ada ',
      lastName: ' Lovelace ',
      verificationCode: '123456',
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
        firstName: 'Ada',
        lastName: 'Lovelace',
        verificationCode: '123456',
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).resolves.toEqual({ message: REGISTRATION_ACKNOWLEDGEMENT });
    expect(repository.createAccount).toHaveBeenCalledWith(
      'owner@example.com',
      expect.stringMatching(/^\$argon2id\$/),
      { firstName: 'Ada', lastName: 'Lovelace' },
    );
    expect(repository.findAccountByEmail).not.toHaveBeenCalled();
  });

  it('preserves unrelated failures for generic error handling', async () => {
    repository.createAccount.mockRejectedValue(
      new Error('Database unavailable'),
    );
    await expect(
      service.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        verificationCode: '123456',
        email: 'owner@example.com',
        password: 'a long passphrase',
      }),
    ).rejects.toThrow('Database unavailable');
  });
});

describe('Supabase Google account sessions', () => {
  const repository = {
    findGoogleAccount: vi.fn(),
    createGoogleAccount: vi.fn(),
    createSession: vi.fn(),
  };
  const identity = { verifyGoogle: vi.fn() };
  const tokens = { issue: vi.fn(), digest: vi.fn() };
  const passwords = { hash: vi.fn() };
  let service: AuthService;
  const account = {
    id: 'local-user',
    email: 'owner@gmail.com',
    passwordHash: 'private-hash',
    createdAt: new Date(),
    isActive: true,
  };
  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthService(
      repository as unknown as AuthRepository,
      tokens as unknown as TokensService,
      passwords as unknown as PasswordHashService,
      identity as unknown as IdentityService,
    );
    identity.verifyGoogle.mockResolvedValue({
      subject: 'google-subject',
      email: 'owner@gmail.com',
    });
    repository.findGoogleAccount.mockResolvedValue(account);
    tokens.issue.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
    });
    tokens.digest.mockReturnValue('refresh-digest');
    passwords.hash.mockResolvedValue('generated-hash');
  });
  it('issues an existing PaServe session only after Supabase verifies Google', async () => {
    const result = await service.google(
      { credential: 'token', keepSignedIn: true },
      'nonce',
    );
    expect(identity.verifyGoogle).toHaveBeenCalledWith('token', 'nonce');
    expect(repository.findGoogleAccount).toHaveBeenCalledWith('google-subject');
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.any(String),
      account.id,
      'refresh-digest',
      expect.any(Date),
      'private-hash',
      account.email,
    );
    expect(result.response.user.email).toBe(account.email);
    expect(result.keepSignedIn).toBe(true);
  });
  it('requires names and registration for a new Google account', async () => {
    repository.findGoogleAccount.mockResolvedValue(null);
    await expect(
      service.google({ credential: 'token' }, 'nonce'),
    ).rejects.toThrow();
    expect(repository.createGoogleAccount).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
    repository.createGoogleAccount.mockResolvedValue(account);
    await service.google(
      { credential: 'token', firstName: 'Ada', lastName: 'Lovelace' },
      'nonce',
    );
    expect(repository.createGoogleAccount).toHaveBeenCalledWith(
      'google-subject',
      'owner@gmail.com',
      'generated-hash',
      { firstName: 'Ada', lastName: 'Lovelace' },
    );
  });
  it('does not create a session for disabled, conflicting or unverified accounts', async () => {
    repository.findGoogleAccount.mockResolvedValue({
      ...account,
      isActive: false,
    });
    await expect(
      service.google({ credential: 'token' }, 'nonce'),
    ).rejects.toThrow();
    repository.findGoogleAccount.mockResolvedValue(null);
    repository.createGoogleAccount.mockResolvedValue(null);
    await expect(
      service.google(
        { credential: 'token', firstName: 'Ada', lastName: 'Lovelace' },
        'nonce',
      ),
    ).rejects.toThrow();
    identity.verifyGoogle.mockRejectedValue(new Error('invalid identity'));
    await expect(
      service.google({ credential: 'token' }, 'nonce'),
    ).rejects.toThrow();
    expect(repository.createSession).not.toHaveBeenCalled();
  });
  it('does not hash or create an email account when Supabase rejects ownership proof', async () => {
    const verifyEmail = vi.fn().mockRejectedValue(new Error('invalid code'));
    service = new AuthService(
      repository as unknown as AuthRepository,
      tokens as unknown as TokensService,
      passwords as unknown as PasswordHashService,
      { verifyEmail } as unknown as IdentityService,
    );
    await expect(
      service.register({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'owner@example.com',
        password: 'long passphrase',
        verificationCode: '123456',
      }),
    ).rejects.toThrow('invalid code');
    expect(passwords.hash).not.toHaveBeenCalled();
  });
});
