import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  RegisterResponse,
  RegisteredUser,
  LoginResponse,
  CurrentUser,
} from '@paserve/contracts';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { AuthRepository } from './auth.repository.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import {
  TokensService,
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
  invalidSession,
} from './tokens.service.js';

@Injectable()
export class AuthService {
  private readonly dummyHash = hash(randomBytes(32).toString('hex'), {
    type: argon2id,
  });

  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokensService,
  ) {}

  async login(dto: LoginDto) {
    const account = await this.repository.findLoginAccount(
      dto.email.trim().toLowerCase(),
    );
    const matches = await verify(
      account?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!account || !matches || !account.isActive) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message:
          'Email or password is incorrect, or the account is unavailable.',
      });
    }
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);
    const pair = await this.tokens.issue(account.id, sessionId, expiresAt);
    await this.repository.createSession(
      sessionId,
      account.id,
      this.tokens.digest(pair.refreshToken),
      expiresAt,
    );
    return {
      response: this.loginResponse(account, pair.accessToken),
      refreshToken: pair.refreshToken,
      expiresAt,
    };
  }

  async refresh(refreshToken: string) {
    const claims = await this.tokens.verify(refreshToken, 'refresh');
    const session = await this.repository.findSession(claims.sid, claims.sub);
    const previousHash = this.tokens.digest(refreshToken);
    if (!session) throw invalidSession();
    if (session.refreshTokenHash !== previousHash) {
      // A signed token for this session was already rotated: possible theft.
      await this.repository.revokeSession(claims.sid, claims.sub);
      throw invalidSession();
    }
    const pair = await this.tokens.issue(
      claims.sub,
      claims.sid,
      session.expiresAt,
    );
    const updated = await this.repository.rotateSession(
      claims.sid,
      claims.sub,
      previousHash,
      this.tokens.digest(pair.refreshToken),
    );
    if (updated.count !== 1) {
      // Concurrent reuse must invalidate the winning token's session too.
      await this.repository.revokeSession(claims.sid, claims.sub);
      throw invalidSession();
    }
    return {
      response: this.loginResponse(session.user, pair.accessToken),
      refreshToken: pair.refreshToken,
      expiresAt: session.expiresAt,
    };
  }

  async currentUser(accessToken: string): Promise<CurrentUser> {
    const claims = await this.tokens.verify(accessToken, 'access');
    const session = await this.repository.findSession(claims.sid, claims.sub);
    if (!session) throw invalidSession();
    return {
      ...this.safeUser(session.user),
      firstName: session.user.firstName,
      lastName: session.user.lastName,
      memberships: session.user.memberships.map((membership) => ({
        id: membership.id,
        shopId: membership.shopId,
        role: membership.role,
        shop: {
          id: membership.shop.id,
          name: membership.shop.name,
          slug: membership.shop.slug,
          isActive: membership.shop.isActive,
          logoUrl: membership.shop.logoUrl,
        },
      })),
    };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    let claims;
    try {
      claims = await this.tokens.verify(refreshToken, 'refresh');
    } catch {
      return;
    }
    await this.repository.revokeSession(claims.sid, claims.sub);
  }

  private safeUser(user: {
    id: string;
    email: string;
    createdAt: Date;
  }): RegisteredUser {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private loginResponse(
    user: { id: string; email: string; createdAt: Date },
    accessToken: string,
  ): LoginResponse {
    return {
      user: this.safeUser(user),
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_SECONDS,
    };
  }

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const email = dto.email.trim().toLowerCase();
    if (await this.repository.findAccountByEmail(email)) {
      throw this.emailConflict();
    }

    const passwordHash = await hash(dto.password, { type: argon2id });
    try {
      const user = await this.repository.createAccount(email, passwordHash);
      return {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        },
      };
    } catch (error: unknown) {
      // The unique index is authoritative when simultaneous requests race.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.emailConflict();
      }
      throw error;
    }
  }

  private emailConflict(): ConflictException {
    return new ConflictException({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email already exists.',
      fieldErrors: { email: ['An account with this email already exists.'] },
    });
  }
}
