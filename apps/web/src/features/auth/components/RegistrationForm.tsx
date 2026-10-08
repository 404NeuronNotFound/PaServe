import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiAlertCircle,
  FiArrowRight,
  FiEye,
  FiEyeOff,
  FiLoader,
} from "react-icons/fi";
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
  const formRef = useRef<HTMLFormElement>(null);
  const pendingFocus = useRef<keyof RegistrationFields | null>(null);
  const touched = useRef<Partial<Record<keyof RegistrationFields, boolean>>>(
    {},
  );
  const mutation = useMutation({
    mutationFn: registerAccount,
    retry: false,
    gcTime: 0,
  });

  useEffect(() => {
    if (!mutation.isPending && pendingFocus.current) {
      formRef.current
        ?.querySelector<HTMLInputElement>(`[name="${pendingFocus.current}"]`)
        ?.focus();
      pendingFocus.current = null;
    }
  }, [errors, mutation.isPending]);

  function updateField(field: keyof RegistrationFields, value: string) {
    const nextFields = { ...fields, [field]: value };
    const nextErrors = validateRegistration(nextFields);
    setFields(nextFields);
    setErrors((current) => ({
      ...current,
      [field]: touched.current[field] ? nextErrors[field] : undefined,
      ...(field === "password" && touched.current.confirmPassword
        ? { confirmPassword: nextErrors.confirmPassword }
        : {}),
    }));
    setFormError("");
  }

  function validateField(field: keyof RegistrationFields) {
    touched.current[field] = true;
    const nextErrors = validateRegistration(fields);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors = validateRegistration(fields);
    touched.current = { email: true, password: true, confirmPassword: true };
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) {
      pendingFocus.current = Object.keys(
        nextErrors,
      )[0] as keyof RegistrationFields;
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
        pendingFocus.current = "email";
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
        pendingFocus.current = details?.email?.length ? "email" : "password";
      } else {
        setFormError("We couldn’t create your account. Please try again.");
      }
      mutation.reset();
    } finally {
      submitting.current = false;
    }
  }

  return (
    <>
      <p className="sr-only" role="status">
        {mutation.isPending ? "Creating your account. Please wait." : ""}
      </p>
      <form
        ref={formRef}
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
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            required
            maxLength={REGISTRATION_LIMITS.emailMax}
            placeholder="you@example.com"
            value={fields.email}
            onChange={(event) => updateField("email", event.target.value)}
            onBlur={() => validateField("email")}
            disabled={mutation.isPending}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && (
            <p className="field-error" id="email-error" role="alert">
              <FiAlertCircle aria-hidden="true" />
              {errors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="password-input">
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
              onBlur={() => validateField("password")}
              disabled={mutation.isPending}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={`password-hint${errors.password ? " password-error" : ""}`}
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
              aria-pressed={showPasswords}
              aria-controls="password confirmPassword"
              disabled={mutation.isPending}
              onClick={() => setShowPasswords((current) => !current)}
            >
              {showPasswords ? (
                <FiEyeOff aria-hidden="true" />
              ) : (
                <FiEye aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="field-hint" id="password-hint">
            Use {REGISTRATION_LIMITS.passwordMin}–
            {REGISTRATION_LIMITS.passwordMax} characters. A longer passphrase
            works well.
          </p>
          {errors.password && (
            <p className="field-error" id="password-error" role="alert">
              <FiAlertCircle aria-hidden="true" />
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
            onBlur={() => validateField("confirmPassword")}
            disabled={mutation.isPending}
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={
              errors.confirmPassword ? "confirm-error" : undefined
            }
          />
          {errors.confirmPassword && (
            <p className="field-error" id="confirm-error" role="alert">
              <FiAlertCircle aria-hidden="true" />
              {errors.confirmPassword}
            </p>
          )}
        </div>
        {formError && (
          <p className="form-error" role="alert">
            <FiAlertCircle aria-hidden="true" />
            {formError}
          </p>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Creating account…" : "Create account"}
          {mutation.isPending ? (
            <FiLoader className="button-icon is-spinning" aria-hidden="true" />
          ) : (
            <FiArrowRight className="button-icon" aria-hidden="true" />
          )}
        </button>
      </form>
    </>
  );
}
