import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  type PendingEmailChange,
} from '../../generated/prisma/client.js';
import { AuthRepository } from './auth.repository.js';
import { TokensService, invalidSession } from './tokens.service.js';
import { IdentityService } from './identity.service.js';
import { PasswordHashService } from './password-hash.service.js';
import type { ChangeEmailDto } from './dto/update-account.dto.js';
import type {
  ConfirmEmailChangeDto,
  EmailChangeCodeDto,
} from './dto/email-change.dto.js';

const lifetime = 15 * 60_000;
const cooldown = 60_000;
const stamp = (hash: string) => createHash('sha256').update(hash).digest('hex');
const invalidChange = () =>
  new BadRequestException({
    code: 'EMAIL_CHANGE_UNAVAILABLE',
    message:
      'This email change expired, was cancelled, or has too many attempts. Start again.',
  });
@Injectable()
export class EmailChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthRepository,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordHashService,
    private readonly identity: IdentityService,
  ) {}
  private async actor(access: string) {
    const claims = await this.tokens.verify(access, 'access');
    const account = await this.repository.findCredentialAccount(
      claims.sub,
      claims.sid,
    );
    if (!account) throw invalidSession();
    return { claims, account };
  }
  private live(userId: string, sessionId: string, hash: string, email: string) {
    return {
      id: userId,
      isActive: true,
      passwordHash: hash,
      email,
      sessions: {
        some: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      },
    };
  }
  private view(row: PendingEmailChange) {
    return {
      id: row.id,
      email: row.newEmail,
      expiresAt: row.expiresAt.toISOString(),
      resendAt: row.resendAt.toISOString(),
      currentConfirmed: row.currentConfirmed,
      newConfirmed: row.newConfirmed,
    };
  }
  private valid(
    row: PendingEmailChange | null,
    account: { email: string; passwordHash: string },
    id?: string,
  ): row is PendingEmailChange {
    return Boolean(
      row &&
      (!id || row.id === id) &&
      row.expiresAt.getTime() > Date.now() &&
      row.attempts < 10 &&
      row.oldEmail === account.email &&
      row.credentialStamp === stamp(account.passwordHash),
    );
  }
  async status(access: string) {
    const { account } = await this.actor(access);
    const row = await this.prisma.pendingEmailChange.findUnique({
      where: { userId: account.id },
    });
    return { pending: this.valid(row, account) ? this.view(row) : null };
  }
  async start(access: string, dto: ChangeEmailDto, nonce?: string) {
    const { claims, account } = await this.actor(access);
    if (account.googleSubject) {
      if (!dto.credential || dto.currentPassword)
        throw new BadRequestException(
          'Confirm with your linked Google account.',
        );
      const google = await this.identity.verifyGoogle(dto.credential, nonce);
      if (google.subject !== account.googleSubject)
        throw new BadRequestException(
          'Use the Google account linked to this PaServe account.',
        );
    } else {
      if (
        !dto.currentPassword ||
        dto.credential ||
        !(await this.passwords.verify(
          account.passwordHash,
          dto.currentPassword,
        ))
      )
        throw new BadRequestException({
          code: 'CURRENT_PASSWORD_INCORRECT',
          message: 'Your current password is incorrect.',
          fieldErrors: {
            currentPassword: ['Your current password is incorrect.'],
          },
        });
    }
    const email = dto.email.trim().toLowerCase();
    if (email === account.email.toLowerCase())
      throw new BadRequestException('Enter a different email address.');
    const existing = await this.repository.findAccountByEmail(email);
    if (existing && existing.id !== account.id) throw this.conflict();
    const now = new Date();
    let row: PendingEmailChange;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const live = await tx.user.updateMany({
          where: this.live(
            account.id,
            claims.sid,
            account.passwordHash,
            account.email,
          ),
          data: { updatedAt: now },
        });
        if (live.count !== 1) throw invalidSession();
        await tx.pendingEmailChange.deleteMany({
          where: {
            userId: account.id,
            OR: [
              { expiresAt: { lte: now } },
              { attempts: { gte: 10 } },
              { credentialStamp: { not: stamp(account.passwordHash) } },
            ],
          },
        });
        return tx.pendingEmailChange.create({
          data: {
            id: randomUUID(),
            userId: account.id,
            oldEmail: account.email,
            newEmail: email,
            credentialStamp: stamp(account.passwordHash),
            expiresAt: new Date(now.getTime() + lifetime),
            resendAt: new Date(now.getTime() + cooldown),
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({
          code: 'EMAIL_CHANGE_PENDING',
          message: 'Finish or cancel your pending email change first.',
        });
      throw error;
    }
    // Never replace the current address or revoke sessions while delivery is pending.
    await this.identity.sendCode(account.email);
    return { pending: this.view(row) };
  }
  async cancel(access: string, id: string) {
    const { account } = await this.actor(access);
    await this.prisma.pendingEmailChange.deleteMany({
      where: { id, userId: account.id },
    });
    return { pending: null };
  }
  async resend(access: string, dto: EmailChangeCodeDto) {
    const { account } = await this.actor(access);
    const row = await this.prisma.pendingEmailChange.findUnique({
      where: { userId: account.id },
    });
    if (!this.valid(row, account, dto.id)) throw invalidChange();
    if (dto.target === 'new' && !row.currentConfirmed)
      throw new BadRequestException('Confirm your current inbox first.');
    if ((dto.target === 'current' && row.currentConfirmed) || row.newConfirmed)
      throw new BadRequestException('This inbox is already confirmed.');
    const now = new Date();
    const reserved = await this.prisma.pendingEmailChange.updateMany({
      where: {
        id: row.id,
        userId: account.id,
        resendAt: { lte: now },
        expiresAt: { gt: now },
        attempts: { lt: 10 },
      },
      data: { resendAt: new Date(now.getTime() + cooldown) },
    });
    if (reserved.count !== 1)
      throw new HttpException(
        {
          code: 'EMAIL_RESEND_WAIT',
          message: 'Wait a minute before requesting another code.',
        },
        429,
      );
    await this.identity.sendCode(
      dto.target === 'current' ? row.oldEmail : row.newEmail,
    );
    return this.status(access);
  }
  async confirm(access: string, dto: ConfirmEmailChangeDto) {
    const { claims, account } = await this.actor(access);
    const row = await this.prisma.pendingEmailChange.findUnique({
      where: { userId: account.id },
    });
    if (!this.valid(row, account, dto.id)) throw invalidChange();
    if (dto.target === 'new' && !row.currentConfirmed)
      throw new BadRequestException('Confirm your current inbox first.');
    if (dto.target === 'current' && row.currentConfirmed)
      return { completed: false, pending: this.view(row) };
    const reserved = await this.prisma.pendingEmailChange.updateMany({
      where: {
        id: row.id,
        userId: account.id,
        attempts: { lt: 10 },
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (reserved.count !== 1) throw invalidChange();
    await this.identity.verifyEmail(
      dto.target === 'current' ? row.oldEmail : row.newEmail,
      dto.code,
    );
    if (dto.target === 'current') {
      const updated = await this.prisma.pendingEmailChange.updateMany({
        where: {
          id: row.id,
          userId: account.id,
          expiresAt: { gt: new Date() },
          currentConfirmed: false,
        },
        data: { currentConfirmed: true, resendAt: new Date() },
      });
      if (updated.count !== 1) throw invalidChange();
      await this.identity.sendCode(row.newEmail);
      await this.prisma.pendingEmailChange.updateMany({
        where: { id: row.id, userId: account.id },
        data: { resendAt: new Date(Date.now() + cooldown) },
      });
      return { completed: false, ...(await this.status(access)) };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        // Claim/delete the pending request first: cancellation and concurrent confirmation are atomic.
        const claimed = await tx.pendingEmailChange.deleteMany({
          where: {
            id: row.id,
            userId: account.id,
            oldEmail: account.email,
            credentialStamp: stamp(account.passwordHash),
            currentConfirmed: true,
            expiresAt: { gt: new Date() },
          },
        });
        if (claimed.count !== 1) throw invalidChange();
        const changed = await tx.user.updateMany({
          where: this.live(
            account.id,
            claims.sid,
            account.passwordHash,
            row.oldEmail,
          ),
          data: {
            email: row.newEmail,
            emailVerifiedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        if (changed.count !== 1) throw invalidSession();
        await tx.authSession.updateMany({
          where: { userId: account.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.conflict();
      throw error;
    }
    return { completed: true, pending: null };
  }
  private conflict() {
    return new ConflictException({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email already exists.',
      fieldErrors: { email: ['An account with this email already exists.'] },
    });
  }
}
