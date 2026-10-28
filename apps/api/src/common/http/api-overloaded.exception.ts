import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiOverloadedException extends HttpException {
  readonly retryAfter = 1;

  constructor() {
    super(
      {
        code: 'API_OVERLOADED',
        message: 'The service is busy. Please wait before trying again.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
