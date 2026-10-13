import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { STAFF_ROLES, type StaffRole } from '@paserve/contracts';

export class StaffRoleDto {
  @IsIn(STAFF_ROLES)
  role!: StaffRole;
}
export class InviteStaffDto extends StaffRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
export class InvitationTokenDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  token!: string;
}
