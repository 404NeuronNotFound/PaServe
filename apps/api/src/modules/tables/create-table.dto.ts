import {
  TABLE_LIMITS,
  TABLE_NUMBER_PATTERN,
  normalizeTableNumber,
  type CreateTableRequest,
} from '@paserve/contracts';
import { Transform } from 'class-transformer';
import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateTableDto implements CreateTableRequest {
  @Transform(({ value }: { value: unknown }) => {
    // Preserve compatibility with the original integer create requests.
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 9999
    )
      return String(value);
    return typeof value === 'string' ? normalizeTableNumber(value) : value;
  })
  @IsString({ message: 'Enter a table number or label.' })
  @MinLength(1, { message: 'Enter a table number or label.' })
  @MaxLength(TABLE_LIMITS.numberMaxLength)
  @Matches(TABLE_NUMBER_PATTERN, {
    message: 'Use a table label without control characters.',
  })
  number!: string;
}
