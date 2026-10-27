import { HttpException } from '@nestjs/common';

export class PasswordCapacityException extends HttpException {
  readonly retryAfter = 1;

  constructor() {
    super(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Authentication is busy. Please wait before trying again.',
      },
      429,
    );
  }
}
