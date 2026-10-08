import { ConflictException, Injectable } from '@nestjs/common';
import type { RegisterResponse } from '@paserve/contracts';
import { argon2id, hash } from 'argon2';
import { Prisma } from '../../generated/prisma/client.js';
import { AuthRepository } from './auth.repository.js';
import type { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

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
