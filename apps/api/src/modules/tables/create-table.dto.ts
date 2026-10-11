import { TABLE_LIMITS, type CreateTableRequest } from '@paserve/contracts';
import { IsInt, Min, Max } from 'class-validator';

export class CreateTableDto implements CreateTableRequest {
  @IsInt({ message: 'Enter a whole table number.' })
  @Min(TABLE_LIMITS.numberMin)
  @Max(TABLE_LIMITS.numberMax)
  number!: number;
}
