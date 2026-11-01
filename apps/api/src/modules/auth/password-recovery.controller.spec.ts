import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import {
  PasswordRecoveryController,
  ResetPasswordDto,
} from './password-recovery.controller.js';
import { AuthOriginGuard } from './guards/auth-origin.guard.js';
import { AuthWorkInterceptor } from './auth-abuse-protection.js';
import { RATE_LIMIT_POLICY } from '../../common/rate-limiting/rate-limit.policy.js';

it('requires origin protection, admission control and a bounded auth policy on both public endpoints', () => {
  expect(
    Reflect.getMetadata(GUARDS_METADATA, PasswordRecoveryController),
  ).toContain(AuthOriginGuard);
  expect(
    Reflect.getMetadata(INTERCEPTORS_METADATA, PasswordRecoveryController),
  ).toContain(AuthWorkInterceptor);
  for (const handler of ['request', 'reset'] as const)
    expect(
      Reflect.getMetadata(
        RATE_LIMIT_POLICY,
        PasswordRecoveryController.prototype[handler],
      ),
    ).toBe('register');
});
it('normalizes email while preserving password whitespace', async () => {
  const dto = plainToInstance(ResetPasswordDto, {
    email: ' Owner@Example.com ',
    code: '012345',
    password: ' a long passphrase ',
  });
  expect(await validate(dto)).toHaveLength(0);
  expect(dto.email).toBe('owner@example.com');
  expect(dto.password).toBe(' a long passphrase ');
});
it.each([
  { code: '123' },
  { code: 'not-a-code' },
  { password: 'short' },
  { password: ' '.repeat(12) },
  { password: 'x'.repeat(129) },
  { email: 'invalid' },
])('rejects malformed recovery credentials %j', async (bad) => {
  const dto = plainToInstance(ResetPasswordDto, {
    email: 'owner@example.com',
    code: '123456',
    password: 'a long passphrase',
    ...bad,
  });
  expect((await validate(dto)).length).toBeGreaterThan(0);
});
