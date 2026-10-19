import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

function fieldErrors(
  errors: ValidationError[],
  parent = '',
): [string, string[]][] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});
    return [
      ...(messages.length ? [[path, messages] as [string, string[]]] : []),
      ...fieldErrors(error.children ?? [], path),
    ];
  });
}

export function requestValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    // EmptyDto intentionally supports cookie-only and multipart actions.
    // Whitelisting still rejects every undeclared body property.
    forbidUnknownValues: false,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        fieldErrors: Object.fromEntries(fieldErrors(errors)),
      }),
  });
}
