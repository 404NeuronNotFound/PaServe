import { REGISTRATION_LIMITS } from "@paserve/contracts";
import isEmail from "validator/lib/isEmail";
import isLength from "validator/lib/isLength";

export interface RegistrationFields {
  email: string;
  password: string;
  confirmPassword: string;
}

export type RegistrationErrors = Partial<
  Record<keyof RegistrationFields, string>
>;

export function validateRegistration(
  fields: RegistrationFields,
): RegistrationErrors {
  const errors: RegistrationErrors = {};
  const email = fields.email.trim();
  if (email.length > REGISTRATION_LIMITS.emailMax || !isEmail(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (
    !isLength(fields.password, {
      min: REGISTRATION_LIMITS.passwordMin,
      max: REGISTRATION_LIMITS.passwordMax,
    })
  ) {
    errors.password = `Use ${REGISTRATION_LIMITS.passwordMin}–${REGISTRATION_LIMITS.passwordMax} characters.`;
  } else if (!/\S/u.test(fields.password)) {
    errors.password = "Password must include a non-space character.";
  }
  if (!fields.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (fields.confirmPassword !== fields.password) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}
