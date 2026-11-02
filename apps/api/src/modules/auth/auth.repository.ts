import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { invalidSession } from './tokens.service.js';
import type { UpdateProfileRequest } from '@paserve/contracts';
import { REGISTRATION_POLICY_VERSION } from '@paserve/contracts';

function registrationPolicyRecord() {
  const now = new Date();
  return {
    registrationPolicyVersion: REGISTRATION_POLICY_VERSION,
    termsAcceptedAt: now,
    privacyAcknowledgedAt: now,
    adultDeclaredAt: now,
  };
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  private liveAccount(userId: string, sessionId: string) {
    return {
      id: userId,
      isActive: true,
      sessions: {
        some: {
          id: sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      },
    };
  }

  findCredentialAccount(userId: string, sessionId: string) {
    return this.prisma.user.findFirst({
      where: this.liveAccount(userId, sessionId),
      select: {
        id: true,
        email: true,
        passwordHash: true,
        googleSubject: true,
      },
    });
  }

  async updateProfile(
    userId: string,
    sessionId: string,
    input: UpdateProfileRequest,
  ) {
    const data = {
      firstName: input.firstName || null,
      lastName: input.lastName || null,
    };
    const result = await this.prisma.user.updateMany({
      where: this.liveAccount(userId, sessionId),
      data,
    });
    if (result.count !== 1) throw invalidSession();
    return data;
  }

  async changeCredentials(
    userId: string,
    sessionId: string,
    previousHash: string,
    data: { email?: string; passwordHash?: string; emailVerifiedAt?: null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Compare the verified hash and live session again at the write boundary.
      const result = await tx.user.updateMany({
        where: {
          ...this.liveAccount(userId, sessionId),
          passwordHash: previousHash,
        },
        data,
      });
      if (result.count !== 1) throw invalidSession();
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  findAccountByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  createAccount(
    email: string,
    passwordHash: string,
    names: { firstName: string; lastName: string },
  ) {
    // Supabase has verified email ownership before this conflict-safe insert.
    // Duplicate attempts preserve existing credentials and do not disclose users.
    return this.prisma.user.createMany({
      data: {
        email,
        passwordHash,
        ...names,
        emailVerifiedAt: new Date(),
        ...registrationPolicyRecord(),
      },
      skipDuplicates: true,
    });
  }

  findGoogleAccount(subject: string) {
    return this.prisma.user.findUnique({ where: { googleSubject: subject } });
  }

  async createGoogleAccount(
    subject: string,
    email: string,
    passwordHash: string,
    names: { firstName: string; lastName: string },
  ) {
    // Never attach a Google identity to an existing password account by email.
    await this.prisma.user.createMany({
      data: {
        googleSubject: subject,
        ...registrationPolicyRecord(),
        email,
        passwordHash,
        ...names,
        emailVerifiedAt: new Date(),
      },
      skipDuplicates: true,
    });
    return this.findGoogleAccount(subject);
  }

  findLoginAccount(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  createSession(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    verifiedPasswordHash: string,
    verifiedEmail: string,
  ) {
    // Lock the account and recheck the verified credential before issuing a
    // session, so an old-password login cannot race a credential change.
    return this.prisma.user.update({
      where: {
        id: userId,
        isActive: true,
        passwordHash: verifiedPasswordHash,
        email: verifiedEmail,
      },
      data: {
        updatedAt: new Date(),
        sessions: { create: { id, refreshTokenHash, expiresAt } },
      },
      select: { id: true },
    });
  }

  findSession(id: string, userId: string) {
    return this.prisma.authSession.findFirst({
      where: {
        id,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            createdAt: true,
            googleSubject: true,
            firstName: true,
            lastName: true,
            memberships: {
              where: { disabledAt: null },
              orderBy: { id: 'asc' },
              select: {
                id: true,
                shopId: true,
                role: true,
                shop: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    isActive: true,
                    logoUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  rotateSession(
    id: string,
    userId: string,
    previousHash: string,
    refreshTokenHash: string,
  ) {
    return this.prisma.authSession.updateMany({
      where: {
        id,
        userId,
        refreshTokenHash: previousHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      data: { refreshTokenHash },
    });
  }

  revokeSession(id: string, userId: string) {
    return this.prisma.authSession.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
