import { IsIn, IsUUID, IsString, Matches } from 'class-validator';
export class EmailChangeIdDto {
  @IsUUID()
  id!: string;
}
export class EmailChangeCodeDto extends EmailChangeIdDto {
  @IsIn(['current', 'new'])
  target!: 'current' | 'new';
}
export class ConfirmEmailChangeDto extends EmailChangeCodeDto {
  @IsString()
  @Matches(/^\d{6,10}$/u)
  code!: string;
}
