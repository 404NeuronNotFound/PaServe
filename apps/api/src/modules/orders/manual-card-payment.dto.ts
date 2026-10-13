import type { ManualCardPaymentRequest } from '@paserve/contracts';
import { ManualGcashPaymentDto } from './manual-gcash-payment.dto.js';

/** The same attestation/reference validation applies to external card settlement. */
export class ManualCardPaymentDto
  extends ManualGcashPaymentDto
  implements ManualCardPaymentRequest {}
