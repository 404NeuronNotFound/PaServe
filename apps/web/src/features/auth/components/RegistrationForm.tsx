import { FormField } from "../../../components/forms/FormField";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { useDraftGuard } from "../../../app/router/useDraftGuard";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiArrowRight, FiEye, FiEyeOff, FiLoader } from "react-icons/fi";
import type { ApiErrorResponse, RegisterResponse } from "@paserve/contracts";
import { REGISTRATION_LIMITS } from "@paserve/contracts";
import { registerAccount } from "../api/register";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import { BotChallenge } from "./BotChallenge";
import { useBotChallenge } from "./useBotChallenge";
import {
  validateRegistration,
  type RegistrationErrors,
  type RegistrationFields,
} from "../validation";

export function RegistrationForm({
  onSuccess,
}: {
  onSuccess: (result: RegisterResponse, submittedEmail: string) => void;
}) {
  const [fields, setFields] = useState<RegistrationFields>({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const challenge = useBotChallenge();
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [formError, setFormError] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const pendingFocus = useRef<keyof RegistrationFields | "form" | null>(null);
  const touched = useRef<Partial<Record<keyof RegistrationFields, boolean>>>(
    {},
  );
  const mutation = useMutation({
    mutationFn: registerAccount,
    retry: false,
    gcTime: 0,
  });
  const navigationGuard = useDraftGuard(Object.values(fields).some(Boolean), mutation.isPending);

  useEffect(() => {
    if (!mutation.isPending && pendingFocus.current) {
      if (pendingFocus.current === "form") formErrorRef.current?.focus();
      else formRef.current
          ?.querySelector<HTMLInputElement>(`[name="${pendingFocus.current}"]`)
          ?.focus();
      pendingFocus.current = null;
    }
  }, [errors, formError, mutation.isPending]);

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
    if (challenge.required && !challenge.token) return;
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
      const submittedEmail = fields.email.trim().toLowerCase();
      const result = await mutation.mutateAsync({
        email: submittedEmail,
        password: fields.password,
        ...(challenge.token ? { challengeToken: challenge.token } : {}),
      });
      setFields({ email: "", password: "", confirmPassword: "" });
      mutation.reset();
      navigationGuard.release();
      onSuccess(result, submittedEmail);
    } catch (error: unknown) {
      const challengeMessage = challenge.handleError(error);
      if (challengeMessage) {
        setFormError(challengeMessage);
        pendingFocus.current = "form";
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
        pendingFocus.current = details?.email?.length ? "email" : details?.password?.length ? "password" : "form";
      } else {
        pendingFocus.current = "form";
        setFormError(
          isAxiosError(error) && error.response?.status === 429
            ? "Too many registration attempts. Please wait and try again."
            : isAxiosError(error) && (!error.response || (error.response.status ?? 0) >= 500)
            ? "We couldn’t confirm account creation. Check your connection, then try signing in with these details before registering again."
            : "We couldn’t create your account. Please try again.",
        );
      }
      mutation.reset();
    } finally {
      challenge.resetToken();
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
        <FormField id="email" label="Email address" error={errors.email} errorId="email-error" required>
          <Input
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
        </FormField>
        <FormField id="password" label="Password" error={errors.password} errorId="password-error" required hint={<>Use {REGISTRATION_LIMITS.passwordMin} to {REGISTRATION_LIMITS.passwordMax} characters. A longer passphrase works well.</>}>
          <div className="password-input">
            <Input
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
            <Button variant="ghost" size="inherit"
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
            </Button>
          </div>
        </FormField>
        <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword} errorId="confirm-error" required>
          <Input
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
        </FormField>
        {formError && <InlineMessage ref={formErrorRef} tabIndex={-1}>{formError}</InlineMessage>}
        {challenge.required && <BotChallenge key={challenge.version} action="register" onToken={challenge.onToken} />}
        <Button variant="default" size="inherit"
          aria-busy={mutation.isPending}
          className="primary-button"
          type="submit"
          disabled={mutation.isPending || (challenge.required && !challenge.token)}
        >
          {mutation.isPending ? "Creating account…" : "Create account"}
          {mutation.isPending ? (
            <FiLoader className="button-icon is-spinning" aria-hidden="true" />
          ) : (
            <FiArrowRight className="button-icon" aria-hidden="true" />
          )}
        </Button>
      </form>
    </>
  );
}
