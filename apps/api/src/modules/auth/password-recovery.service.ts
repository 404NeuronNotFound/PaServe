import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { IdentityService } from './identity.service.js';
import { PasswordHashService } from './password-hash.service.js';
import { throwIfRequestAborted } from '../../common/http/request-context.js';
import type { ResetPasswordDto } from './password-recovery.controller.js';

export const invalidRecovery = () =>
  new BadRequestException({
    code: 'INVALID_RECOVERY_CODE',
    message:
      'The reset code is invalid, expired, or already used. Request a new code and try again.',
  });

@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly passwords: PasswordHashService,
  ) {}

  async reset(input: ResetPasswordDto) {
    const email = input.email.trim().toLowerCase();
    const account = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
        googleSubject: true,
      },
    });
    // Only a Supabase recovery OTP is accepted. Signup/Google/session tokens cannot reset a password.
    await this.identity.verifyRecoveryCode(email, input.code);
    if (!account?.isActive || account.googleSubject) throw invalidRecovery();
    throwIfRequestAborted();
    const passwordHash = await this.passwords.hash(input.password);
    throwIfRequestAborted();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: {
          id: account.id,
          email: account.email,
          passwordHash: account.passwordHash,
          isActive: true,
          googleSubject: null,
        },
        data: { passwordHash, emailVerifiedAt: new Date() },
      });
      if (changed.count !== 1) throw invalidRecovery();
      await tx.authSession.updateMany({
        where: { userId: account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.pendingEmailChange.deleteMany({ where: { userId: account.id } });
    });
    return {
      message: 'Your password has been reset. Sign in with your new password.',
    };
  }
}
