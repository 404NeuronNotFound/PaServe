import { HttpException, HttpStatus } from '@nestjs/common';

export class RequestTimeoutException extends HttpException {
  constructor() {
    super(
      {
        code: 'REQUEST_TIMEOUT',
        message:
          'The request took too long. Check its outcome before trying again.',
      },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}
