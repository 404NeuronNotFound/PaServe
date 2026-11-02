import { Equals } from 'class-validator';
import {
  REGISTRATION_POLICY_VERSION,
  type RegistrationPolicy,
} from '@paserve/contracts';

export class RegistrationPolicyDto implements RegistrationPolicy {
  @Equals(REGISTRATION_POLICY_VERSION, {
    message: 'Review the current Terms and Privacy Notice.',
  })
  policyVersion!: typeof REGISTRATION_POLICY_VERSION;

  @Equals(true, {
    message: 'PaServe business accounts require you to be 18 or older.',
  })
  adultConfirmed!: true;

  @Equals(true, {
    message: 'Accept the Terms of Service to create an account.',
  })
  termsAccepted!: true;

  @Equals(true, { message: 'Read and acknowledge the Privacy Notice.' })
  privacyAcknowledged!: true;
}
