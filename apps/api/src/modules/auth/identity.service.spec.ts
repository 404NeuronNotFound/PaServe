import { Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityService } from './identity.service.js';
const fake = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithIdToken: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: fake.create }));
const warning = vi.fn();
let service: IdentityService;
const nonce = 'a'.repeat(64);
const googleUser = () => ({
  email: 'owner@gmail.com',
  email_confirmed_at: '2026-11-01',
  identities: [
    {
      provider: 'google',
      identity_data: {
        sub: 'google-user',
        email: 'Owner@gmail.com',
        email_verified: true,
      },
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(warning);
  fake.create.mockReturnValue({ auth: fake });
  service = new IdentityService(
    new ConfigService({
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key',
    }),
  );
});
it('uses Supabase Auth to deliver the verification code without exposing a token', async () => {
  fake.signInWithOtp.mockResolvedValue({ error: null });
  const result = await service.sendCode('owner@example.com');
  expect(fake.signInWithOtp).toHaveBeenCalledWith({
    email: 'owner@example.com',
    options: { shouldCreateUser: true },
  });
  expect(Object.keys(result)).toEqual(['message']);
  expect(fake.create).toHaveBeenCalledWith(
    'https://project.supabase.co',
    'public-key',
    expect.objectContaining({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  );
});
it('fails closed when Supabase email delivery fails', async () => {
  fake.signInWithOtp.mockResolvedValue({
    error: { message: 'provider diagnostic' },
  });
  await expect(service.sendCode('owner@example.com')).rejects.toThrow(
    'We could not send',
  );
});
it('verifies email ownership through Supabase single-use OTP', async () => {
  fake.verifyOtp.mockResolvedValue({
    error: null,
    data: {
      user: { email: 'owner@example.com', email_confirmed_at: '2026-11-01' },
    },
  });
  await service.verifyEmail('owner@example.com', '123456');
  expect(fake.verifyOtp).toHaveBeenCalledWith({
    email: 'owner@example.com',
    token: '123456',
    type: 'email',
  });
});
it.each([
  {
    error: { message: 'expired, incorrect or reused code' },
    data: { user: null },
  },
  {
    error: null,
    data: {
      user: { email: 'other@example.com', email_confirmed_at: '2026-11-01' },
    },
  },
  { error: null, data: { user: { email: 'owner@example.com' } } },
])('rejects invalid Supabase verification results %j', async (result) => {
  fake.verifyOtp.mockResolvedValue(result);
  await expect(
    service.verifyEmail('owner@example.com', '123456'),
  ).rejects.toThrow();
});
it('uses Supabase to verify Google identity and the original nonce', async () => {
  fake.signInWithIdToken.mockResolvedValue({
    error: null,
    data: { user: googleUser() },
  });
  await expect(service.verifyGoogle('google-token', nonce)).resolves.toEqual({
    subject: 'google-user',
    email: 'owner@gmail.com',
  });
  expect(fake.signInWithIdToken).toHaveBeenCalledWith({
    provider: 'google',
    token: 'google-token',
    nonce,
  });
});
it.each([
  'provider-error',
  'unverified',
  'no-google-identity',
  'untrusted-email',
])('rejects Google identity %s', async (kind) => {
  const user = googleUser();
  if (kind === 'unverified')
    user.identities[0].identity_data.email_verified = false;
  if (kind === 'no-google-identity') user.identities = [];
  if (kind === 'untrusted-email')
    user.identities[0].identity_data.email = 'owner@third-party.example';
  fake.signInWithIdToken.mockResolvedValue({
    error: kind === 'provider-error' ? {} : null,
    data: { user },
  });
  await expect(service.verifyGoogle('token', nonce)).rejects.toThrow();
});
it('rejects absent nonce before calling Supabase', async () => {
  await expect(service.verifyGoogle('token', undefined)).rejects.toThrow();
  expect(fake.signInWithIdToken).not.toHaveBeenCalled();
});
it('requires Supabase configuration', async () => {
  service = new IdentityService(new ConfigService());
  await expect(service.sendCode('owner@example.com')).rejects.toThrow();
});

it.each([
  [
    'email_address_not_authorized',
    403,
    503,
    'EMAIL_DELIVERY_NOT_CONFIGURED',
    'sender_restricted',
  ],
  [
    'over_email_send_rate_limit',
    429,
    429,
    'EMAIL_RATE_LIMITED',
    'rate_limited',
  ],
  ['over_request_rate_limit', 429, 429, 'EMAIL_RATE_LIMITED', 'rate_limited'],
  ['unexpected_code', 429, 429, 'EMAIL_RATE_LIMITED', 'rate_limited'],
  [
    'email_provider_disabled',
    400,
    503,
    'EMAIL_SIGNUP_DISABLED',
    'signup_disabled',
  ],
  ['signup_disabled', 422, 503, 'EMAIL_SIGNUP_DISABLED', 'signup_disabled'],
  ['unexpected_code', 500, 503, 'EMAIL_UNAVAILABLE', 'delivery_failed'],
])(
  'classifies Supabase delivery error %s without leaking provider details',
  async (providerCode, providerStatus, status, code, reason) => {
    fake.signInWithOtp.mockResolvedValue({
      error: {
        code: providerCode,
        status: providerStatus,
        message: 'private@example.com token=private-provider-token',
      },
    });
    try {
      await service.sendCode('owner@example.com');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const failure = error as HttpException;
      expect(failure.getStatus()).toBe(status);
      expect(failure.getResponse()).toMatchObject({ code });
      expect(JSON.stringify(failure.getResponse())).not.toContain('private');
    }
    expect(warning).toHaveBeenCalledWith({
      event: 'verification_email_failed',
      provider: 'supabase-auth',
      reason,
      status: providerStatus,
    });
  },
);

it('uses the Supabase recovery email endpoint with a generic acknowledgement', async () => {
  fake.resetPasswordForEmail.mockResolvedValue({ error: null });
  const result = await service.sendRecoveryCode('owner@example.com');
  expect(fake.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com');
  expect(result.message).toContain('If this email');
  expect(Object.keys(result)).toEqual(['message']);
});
it('accepts only confirmed matching recovery email proof and never returns a provider token', async () => {
  fake.verifyOtp.mockResolvedValue({
    data: {
      user: { email: 'owner@example.com', email_confirmed_at: '2026-11-01' },
      session: { access_token: 'private-token' },
    },
    error: null,
  });
  expect(
    await service.verifyRecoveryCode('owner@example.com', '123456'),
  ).toBeUndefined();
  expect(fake.verifyOtp).toHaveBeenCalledWith({
    email: 'owner@example.com',
    token: '123456',
    type: 'recovery',
  });
  fake.verifyOtp.mockResolvedValue({
    data: {
      user: { email: 'other@example.com', email_confirmed_at: '2026-11-01' },
    },
    error: null,
  });
  await expect(
    service.verifyRecoveryCode('owner@example.com', '123456'),
  ).rejects.toThrow('reset code');
});
