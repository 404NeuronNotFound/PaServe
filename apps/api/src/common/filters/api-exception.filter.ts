import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@paserve/contracts';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let body: ApiErrorResponse = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong. Please try again.',
    };
    if (exception instanceof HttpException) {
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
