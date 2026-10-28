import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type {
  RegisterResponse,
  RegisteredUser,
  LoginResponse,
  CurrentUser,
} from '@paserve/contracts';
import { randomUUID } from 'node:crypto';
import { PasswordHashService } from './password-hash.service.js';
import {
  SESSION_LIMITS,
  REGISTRATION_ACKNOWLEDGEMENT,
} from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { AuthRepository } from './auth.repository.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type {
  UpdateProfileDto,
  ChangeEmailDto,
  ChangePasswordDto,
} from './dto/update-account.dto.js';
import { TokensService, invalidSession } from './tokens.service.js';
import { throwIfRequestAborted } from '../../common/http/request-context.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordHashService,
  ) {}

  async login(dto: LoginDto) {
    // Both paths wait for startup hash preparation; missing accounts do not take
    // a separate first-request path and always perform password verification.
    const dummyHash = await this.passwords.dummyHash();
    const account = await this.repository.findLoginAccount(
      dto.email.trim().toLowerCase(),
    );
    const matches = await this.passwords.verify(
      account?.passwordHash ?? dummyHash,
      dto.password,
    );
    throwIfRequestAborted();
    if (!account || !matches || !account.isActive) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message:
          'Email or password is incorrect, or the account is unavailable.',
      });
    }
    const sessionId = randomUUID();
    const keepSignedIn = dto.keepSignedIn === true;
    const lifetime = keepSignedIn
      ? SESSION_LIMITS.personalSeconds
      : SESSION_LIMITS.sharedSeconds;
    const expiresAt = new Date(Date.now() + lifetime * 1000);
    const pair = await this.tokens.issue(
      account.id,
      sessionId,
      expiresAt,
      keepSignedIn,
    );
    try {
      throwIfRequestAborted();
      await this.repository.createSession(
        sessionId,
        account.id,
        this.tokens.digest(pair.refreshToken),
        expiresAt,
        account.passwordHash,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      )
        throw invalidSession();
      throw error;
    }
    return {
      response: this.loginResponse(account, pair.accessToken, pair.expiresIn),
      refreshToken: pair.refreshToken,
      expiresAt,
      keepSignedIn,
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
      claims.keepSignedIn ?? true,
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
      response: this.loginResponse(
        session.user,
        pair.accessToken,
        pair.expiresIn,
      ),
      refreshToken: pair.refreshToken,
      expiresAt: session.expiresAt,
      keepSignedIn: claims.keepSignedIn ?? true,
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

  async updateProfile(accessToken: string, dto: UpdateProfileDto) {
    const claims = await this.tokens.verify(accessToken, 'access');
    return this.repository.updateProfile(claims.sub, claims.sid, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });
  }

  async changeCredentials(
    accessToken: string,
    dto: ChangeEmailDto | ChangePasswordDto,
  ) {
    const claims = await this.tokens.verify(accessToken, 'access');
    const account = await this.repository.findCredentialAccount(
      claims.sub,
      claims.sid,
    );
    if (!account) throw invalidSession();
    if (
      !(await this.passwords.verify(account.passwordHash, dto.currentPassword))
    ) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Your current password is incorrect.',
        fieldErrors: {
          currentPassword: ['Your current password is incorrect.'],
        },
      });
    }
    let data: { email?: string; passwordHash?: string };
    if ('email' in dto) {
      const email = dto.email.trim().toLowerCase();
      if (email === account.email.toLowerCase())
        throw new BadRequestException('Enter a different email address.');
      const existing = await this.repository.findAccountByEmail(email);
      if (existing && existing.id !== account.id) throw this.emailConflict();
      // Rehash even for an email change to invalidate a concurrently verified
      // login using the previous address at the conditional session write.
      data = {
        email,
        passwordHash: await this.passwords.hash(dto.currentPassword),
      };
    } else {
      if (await this.passwords.verify(account.passwordHash, dto.password))
        throw new BadRequestException('Choose a different password.');
      data = { passwordHash: await this.passwords.hash(dto.password) };
    }
    try {
      throwIfRequestAborted();
      await this.repository.changeCredentials(
        claims.sub,
        claims.sid,
        account.passwordHash,
        data,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw this.emailConflict();
      throw error;
    }
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
    expiresIn: number,
  ): LoginResponse {
    return {
      user: this.safeUser(user),
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const email = dto.email.trim().toLowerCase();
    // Always hash, then perform the same conflict-safe INSERT. No account-existence
    // fast path, user details, or duplicate-specific response is exposed publicly.
    const passwordHash = await this.passwords.hash(dto.password);
    throwIfRequestAborted();
    await this.repository.createAccount(email, passwordHash);
    return { message: REGISTRATION_ACKNOWLEDGEMENT };
  }

  private emailConflict(): ConflictException {
    return new ConflictException({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'An account with this email already exists.',
      fieldErrors: { email: ['An account with this email already exists.'] },
    });
  }
}
