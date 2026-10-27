import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { invalidSession } from './tokens.service.js';
import type { UpdateProfileRequest } from '@paserve/contracts';

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
      select: { id: true, email: true, passwordHash: true },
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
    data: { email?: string; passwordHash?: string },
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

  createAccount(email: string, passwordHash: string) {
    // ON CONFLICT DO NOTHING preserves existing credentials and avoids both
    // duplicate-specific errors and aborting an enclosing PostgreSQL transaction.
    return this.prisma.user.createMany({
      data: { email, passwordHash },
      skipDuplicates: true,
    });
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
  ) {
    // Lock the account and recheck the verified credential before issuing a
    // session, so an old-password login cannot race a credential change.
    return this.prisma.user.update({
      where: { id: userId, isActive: true, passwordHash: verifiedPasswordHash },
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
