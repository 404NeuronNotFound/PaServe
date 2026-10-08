import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import type { ApiErrorResponse, RegisterResponse } from "@paserve/contracts";
import { REGISTRATION_LIMITS } from "@paserve/contracts";
import { registerAccount } from "../api/register";
import {
  validateRegistration,
  type RegistrationErrors,
  type RegistrationFields,
} from "../validation";

export function RegistrationForm({
  onSuccess,
}: {
  onSuccess: (result: RegisterResponse) => void;
}) {
  const [fields, setFields] = useState<RegistrationFields>({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [formError, setFormError] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: registerAccount,
    retry: false,
    gcTime: 0,
  });

  function updateField(field: keyof RegistrationFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors = validateRegistration(fields);
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) {
      const first = Object.keys(nextErrors)[0];
      document.getElementById(first)?.focus();
      return;
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync({
        email: fields.email.trim().toLowerCase(),
        password: fields.password,
      });
      setFields({ email: "", password: "", confirmPassword: "" });
      mutation.reset();
      onSuccess(result);
    } catch (error: unknown) {
      if (
        isAxiosError<ApiErrorResponse>(error) &&
        error.response?.data?.code === "EMAIL_ALREADY_EXISTS"
      ) {
        setErrors({ email: "An account with this email already exists." });
        document.getElementById("email")?.focus();
      } else if (
        isAxiosError<ApiErrorResponse>(error) &&
        error.response?.data?.code === "VALIDATION_ERROR"
      ) {
        const details = error.response.data.fieldErrors;
        setErrors({
          email: details?.email?.[0],
          password: details?.password?.[0],
        });
        setFormError("Please check your email and password.");
      } else {
        setFormError("We couldn’t create your account. Please try again.");
      }
      mutation.reset();
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form
      className="registration-form"
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
      aria-busy={mutation.isPending}
    >
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={REGISTRATION_LIMITS.emailMax}
          placeholder="you@example.com"
          value={fields.email}
          onChange={(event) => updateField("email", event.target.value)}
          disabled={mutation.isPending}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        {errors.email && (
          <p className="field-error" id="email-error" role="alert">
            {errors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={REGISTRATION_LIMITS.passwordMin}
          maxLength={REGISTRATION_LIMITS.passwordMax}
          value={fields.password}
          onChange={(event) => updateField("password", event.target.value)}
          disabled={mutation.isPending}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={`password-hint${errors.password ? " password-error" : ""}`}
        />
        <p className="field-hint" id="password-hint">
          Use {REGISTRATION_LIMITS.passwordMin}–
          {REGISTRATION_LIMITS.passwordMax} characters. A longer passphrase
          works well.
        </p>
        {errors.password && (
          <p className="field-error" id="password-error" role="alert">
            {errors.password}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="confirmPassword">Confirm password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type={showPasswords ? "text" : "password"}
          autoComplete="new-password"
          required
          maxLength={REGISTRATION_LIMITS.passwordMax}
          value={fields.confirmPassword}
          onChange={(event) =>
            updateField("confirmPassword", event.target.value)
          }
          disabled={mutation.isPending}
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={
            errors.confirmPassword ? "confirm-error" : undefined
          }
        />
        {errors.confirmPassword && (
          <p className="field-error" id="confirm-error" role="alert">
            {errors.confirmPassword}
          </p>
        )}
      </div>
      <label className="show-passwords">
        <input
          type="checkbox"
          checked={showPasswords}
          disabled={mutation.isPending}
          onChange={(event) => setShowPasswords(event.target.checked)}
        />
        Show passwords
      </label>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <button
        className="primary-button"
        type="submit"
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "Creating account…" : "Create account"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
