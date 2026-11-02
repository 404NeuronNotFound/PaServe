import {
  REGISTRATION_POLICY_VERSION,
  type RegistrationPolicy,
} from "@paserve/contracts";
export type PolicyChoices = {
  adultConfirmed: boolean;
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
};
export const emptyPolicyChoices: PolicyChoices = {
  adultConfirmed: false,
  termsAccepted: false,
  privacyAcknowledged: false,
};
export function acceptedRegistrationPolicy(
  choices: PolicyChoices,
): RegistrationPolicy | undefined {
  return choices.adultConfirmed &&
    choices.termsAccepted &&
    choices.privacyAcknowledged
    ? {
        policyVersion: REGISTRATION_POLICY_VERSION,
        adultConfirmed: true,
        termsAccepted: true,
        privacyAcknowledged: true,
      }
    : undefined;
}
