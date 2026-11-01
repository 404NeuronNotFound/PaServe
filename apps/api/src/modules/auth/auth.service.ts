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
import { IdentityService } from './identity.service.js';
import type { GoogleLoginDto, GoogleRegisterDto } from './dto/identity.dto.js';
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
    private readonly identity: IdentityService,
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
    return this.startSession(account, dto.keepSignedIn === true);
  }

  private async startSession(
    account: {
      id: string;
      email: string;
      passwordHash: string;
      createdAt: Date;
    },
    keepSignedIn: boolean,
  ) {
    const sessionId = randomUUID();
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
        account.email,
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

  async google(
    dto: GoogleLoginDto | GoogleRegisterDto,
    nonce: string | undefined,
  ) {
    const identity = await this.identity.verifyGoogle(dto.credential, nonce);
    let account = await this.repository.findGoogleAccount(identity.subject);
    if (!account && 'firstName' in dto) {
      account = await this.repository.createGoogleAccount(
        identity.subject,
        identity.email,
        await this.passwords.hash(randomUUID() + randomUUID()),
        { firstName: dto.firstName, lastName: dto.lastName },
      );
    }
    if (!account || !account.isActive)
      throw new UnauthorizedException({
        code: 'GOOGLE_ACCOUNT_UNAVAILABLE',
        message:
          'No available Google account was found. Create an account with Google first, or sign in with your existing email and password.',
      });
    return this.startSession(
      account,
      'keepSignedIn' in dto && dto.keepSignedIn === true,
    );
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
      signInMethod: session.user.googleSubject ? 'google' : 'email',
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

  async changeCredentials(accessToken: string, dto: ChangePasswordDto) {
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
    if (await this.passwords.verify(account.passwordHash, dto.password))
      throw new BadRequestException('Choose a different password.');
    const data = { passwordHash: await this.passwords.hash(dto.password) };
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
    // Supabase owns challenge expiry, retry limits and single-use consumption.
    await this.identity.verifyEmail(email, dto.verificationCode);
    // No account-existence fast path or duplicate-specific response is exposed.
    const passwordHash = await this.passwords.hash(dto.password);
    throwIfRequestAborted();
    await this.repository.createAccount(email, passwordHash, {
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
    });
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
