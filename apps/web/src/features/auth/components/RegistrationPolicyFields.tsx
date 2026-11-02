import type { PolicyChoices } from "../registration-policy";
import { Input } from "../../../components/ui/input";
import { Link } from "react-router-dom";
import "../../../pages/public/legal.css";

export function RegistrationPolicyFields({
  choices,
  onChange,
  disabled,
}: {
  choices: PolicyChoices;
  onChange: (choices: PolicyChoices) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="registration-policy" disabled={disabled}>
      <legend className="sr-only">Account agreements</legend>
      <p className="registration-policy-heading" aria-hidden="true">
        Before you create your account
      </p>
      <label>
        <Input
          id="adult-confirmed"
          type="checkbox"
          checked={choices.adultConfirmed}
          onChange={(e) =>
            onChange({ ...choices, adultConfirmed: e.target.checked })
          }
        />
        <span>
          <span className="registration-policy-title">I am 18 or older.</span>
          <span className="registration-policy-description">
            I am authorised to use this account and consent to recording this
            eligibility declaration.
          </span>
        </span>
      </label>
      <label>
        <Input
          type="checkbox"
          checked={choices.termsAccepted}
          onChange={(e) =>
            onChange({ ...choices, termsAccepted: e.target.checked })
          }
        />
        <span>
          I agree to the{" "}
          <Link to="/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </span>
      </label>
      <label>
        <Input
          type="checkbox"
          checked={choices.privacyAcknowledged}
          onChange={(e) =>
            onChange({ ...choices, privacyAcknowledged: e.target.checked })
          }
        />
        <span>
          I have read the{" "}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Notice<span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </span>
      </label>
      <p>
        Self-declared eligibility. No marketing consent. Under 18? Ask a parent
        or guardian to help with customer orders.
      </p>
    </fieldset>
  );
}
