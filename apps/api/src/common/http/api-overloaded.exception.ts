import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiOverloadedException extends HttpException {
  constructor(readonly retryAfter = 1) {
    super(
      {
        code: 'API_OVERLOADED',
        message: 'The service is busy. Please wait before trying again.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
