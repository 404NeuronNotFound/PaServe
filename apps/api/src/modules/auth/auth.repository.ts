import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
  }

  createAccount(email: string, passwordHash: string) {
    return this.prisma.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, createdAt: true },
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
  ) {
    return this.prisma.authSession.create({
      data: { id, userId, refreshTokenHash, expiresAt },
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
      include: { user: { select: { id: true, email: true, createdAt: true } } },
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
