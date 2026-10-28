import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorResponse, OrderPriceChange } from '@paserve/contracts';
import { OrderPriceChangedException } from '../http/order-price-changed.exception.js';
import { PasswordCapacityException } from '../http/password-capacity.exception.js';
import { ApiOverloadedException } from '../http/api-overloaded.exception.js';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    // Disconnected callers must not trigger a second write or error-log storm.
    if (response.destroyed || response.writableEnded) return;
    let body: ApiErrorResponse & Partial<OrderPriceChange> = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again.',
    };
    if (exception instanceof HttpException) {
      if (
        exception instanceof PasswordCapacityException ||
        exception instanceof ApiOverloadedException
      ) {
        response.setHeader('Retry-After', exception.retryAfter);
        response.setHeader('Cache-Control', 'no-store');
      }
      const payload = exception.getResponse();
      const fields =
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>)
          : {};
      body = {
        statusCode: exception.getStatus(),
        code: typeof fields.code === 'string' ? fields.code : 'REQUEST_ERROR',
        message:
          typeof fields.code === 'string' && typeof fields.message === 'string'
            ? fields.message
            : 'The request could not be processed.',
      };
      if (fields.fieldErrors && typeof fields.fieldErrors === 'object') {
        body.fieldErrors = fields.fieldErrors as Record<string, string[]>;
      }
      if (exception instanceof OrderPriceChangedException) {
        body.currency = exception.priceChange.currency;
        body.totalPrice = exception.priceChange.totalPrice;
        body.items = exception.priceChange.items;
      }
    } else if (
      exception instanceof Error &&
      'type' in exception &&
      exception.type === 'entity.too.large' &&
      'status' in exception &&
      exception.status === HttpStatus.PAYLOAD_TOO_LARGE
    ) {
      body = {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'REQUEST_TOO_LARGE',
        message: 'The request is too large.',
      };
    } else {
      // Do not log request bodies, Prisma query parameters, or password data.
      this.logger.error(
        'Unhandled API failure',
        exception instanceof Error ? exception.name : 'Unknown error',
      );
    }
    response.status(body.statusCode).json(body);
  }
}
