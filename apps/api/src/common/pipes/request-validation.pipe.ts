import { BadRequestException, ValidationPipe } from '@nestjs/common';

export function requestValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        fieldErrors: Object.fromEntries(
          errors.map((error) => [
            error.property,
            Object.values(error.constraints ?? {}),
          ]),
        ),
      }),
  });
}
