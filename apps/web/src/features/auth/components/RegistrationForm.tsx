import "./auth-forms.css";
import { FormField } from "../../../components/forms/FormField";
import { Input } from "../../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { useVerificationDialogPosition } from "./useVerificationDialogPosition";
import { useDraftGuard } from "../../../app/router/useDraftGuard";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiArrowRight,
  FiEye,
  FiEyeOff,
  FiLoader,
  FiMail,
  FiCheck,
} from "react-icons/fi";
import type {
  ApiErrorResponse,
  RegisterResponse,
  LoginResponse,
} from "@paserve/contracts";
import { ACCOUNT_LIMITS, REGISTRATION_LIMITS } from "@paserve/contracts";
import { GoogleSignIn } from "./GoogleSignIn";
import { registerAccount, requestEmailCode } from "../api/register";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import { BotChallenge } from "./BotChallenge";
import { useBotChallenge } from "./useBotChallenge";
import { RegistrationPolicyFields } from "./RegistrationPolicyFields";
import {
  emptyPolicyChoices,
  acceptedRegistrationPolicy,
} from "../registration-policy";
import {
  validateRegistration,
  type RegistrationErrors,
  type RegistrationFields,
} from "../validation";

export function RegistrationForm({
  onSuccess,
  onGoogleSuccess,
}: {
  onGoogleSuccess?: (session: LoginResponse) => void;
  onSuccess: (result: RegisterResponse, submittedEmail: string) => void;
}) {
  const [fields, setFields] = useState<RegistrationFields>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<"email" | "google">("email");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [policyChoices, setPolicyChoices] = useState(emptyPolicyChoices);
  const policy = acceptedRegistrationPolicy(policyChoices);
  const codeRef = useRef<HTMLInputElement>(null);
  const mainActionRef = useRef<HTMLButtonElement>(null);
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [codeMessage, setCodeMessage] = useState("");
  const challenge = useBotChallenge();
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [formError, setFormError] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const verificationDialogRef = useVerificationDialogPosition(
    verificationOpen,
    formRef,
  );
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const pendingFocus = useRef<
    keyof RegistrationFields | "form" | "code" | null
  >(null);
  const touched = useRef<Partial<Record<keyof RegistrationFields, boolean>>>(
    {},
  );
  const mutation = useMutation({
    mutationFn: registerAccount,
    retry: false,
    gcTime: 0,
  });
  const pending = mutation.isPending || sendingCode;
  const navigationGuard = useDraftGuard(
    Object.values(fields).some(Boolean) ||
      Object.values(policyChoices).some(Boolean),
    pending,
  );

  useEffect(() => {
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (!pending && pendingFocus.current) {
      if (pendingFocus.current === "form") formErrorRef.current?.focus();
      else if (pendingFocus.current === "code") codeRef.current?.focus();
      else
        formRef.current
          ?.querySelector<HTMLInputElement>(`[name="${pendingFocus.current}"]`)
          ?.focus();
      pendingFocus.current = null;
    }
  }, [errors, formError, pending, verificationOpen, step]);

  function fieldStep(field: keyof RegistrationFields) {
    return field === "password" || field === "confirmPassword" ? 1 : 0;
  }
  function moveStep(next: number) {
    setFormError("");
    setStep(next);
  }
  function chooseGoogle() {
    const all = validateRegistration(fields);
    const next = {
      ...(all.firstName ? { firstName: all.firstName } : {}),
      ...(all.lastName ? { lastName: all.lastName } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length) {
      pendingFocus.current = all.firstName ? "firstName" : "lastName";
      return;
    }
    setMethod("google");
    moveStep(2);
  }

  function updateField(field: keyof RegistrationFields, value: string) {
    if (field === "email") {
      setVerificationRequested(false);
      setVerificationCode("");
      setCodeMessage("");
    }
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

  async function submit(event: FormEvent<HTMLFormElement>, verify = false) {
    event.preventDefault();
    if (submitting.current) return;
    if (!verify && step < 2) {
      const all = validateRegistration(fields);
      const keys: (keyof RegistrationFields)[] =
        step === 0
          ? ["firstName", "lastName", "email"]
          : ["password", "confirmPassword"];
      const next: RegistrationErrors = {};
      for (const key of keys) {
        touched.current[key] = true;
        if (all[key]) next[key] = all[key];
      }
      setErrors(next);
      if (Object.keys(next).length) {
        pendingFocus.current = keys.find((key) => next[key])!;
        return;
      }
      setMethod("email");
      moveStep(step + 1);
      return;
    }
    if (method === "google") return;
    if (
      (verify || !verificationRequested) &&
      challenge.required &&
      !challenge.token
    )
      return;
    const nextErrors = validateRegistration(fields);
    touched.current = {
      firstName: true,
      lastName: true,
      email: true,
      password: true,
      confirmPassword: true,
    };
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) {
      setVerificationOpen(false);
      setStep(
        fieldStep(Object.keys(nextErrors)[0] as keyof RegistrationFields),
      );
      pendingFocus.current = Object.keys(
        nextErrors,
      )[0] as keyof RegistrationFields;
      return;
    }
    if (!policy) {
      setVerificationOpen(false);
      setFormError(
        "Confirm you are 18 or older, agree to the Terms, and acknowledge the Privacy Notice before continuing.",
      );
      pendingFocus.current = "form";
      return;
    }
    if (verificationRequested && !verify) {
      setFormError("");
      setVerificationOpen(true);
      return;
    }
    submitting.current = true;
    try {
      const submittedEmail = fields.email.trim().toLowerCase();
      if (!verificationRequested) {
        setSendingCode(true);
        const proof = await requestEmailCode(
          submittedEmail,
          policy,
          challenge.token || undefined,
        );
        setVerificationOpen(true);
        setVerificationRequested(true);
        setCodeMessage(proof.message);
        // The next render mounts the code field; focus it after sending finishes.
        return;
      }
      if (!/^\d{6,8}$/u.test(verificationCode)) {
        setFormError("Enter the verification code from your email.");
        pendingFocus.current = "form";
        return;
      }
      const result = await mutation.mutateAsync({
        ...policy,
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        verificationCode,
        email: submittedEmail,
        password: fields.password,
        ...(challenge.token ? { challengeToken: challenge.token } : {}),
      });
      setFields({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        confirmPassword: "",
      });
      setVerificationOpen(false);
      setStep(0);
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
          firstName: details?.firstName?.[0],
          lastName: details?.lastName?.[0],
          email: details?.email?.[0],
          password: details?.password?.[0],
        });
        const policyRejected = [
          "policyVersion",
          "adultConfirmed",
          "termsAccepted",
          "privacyAcknowledged",
        ].some((key) => details?.[key]?.length);
        setFormError(
          policyRejected
            ? "Registration requirements have changed. Reload this page, review the current Terms and Privacy Notice, then try again."
            : "Please check your email and password.",
        );
        const invalidField = (
          ["firstName", "lastName", "email", "password"] as const
        ).find((key) => details?.[key]?.length);
        if (invalidField || policyRejected) setVerificationOpen(false);
        if (invalidField) setStep(fieldStep(invalidField));
        else if (policyRejected) setStep(2);
        pendingFocus.current = invalidField ?? "form";
      } else if (
        isAxiosError<ApiErrorResponse>(error) &&
        error.response?.data?.code === "INVALID_VERIFICATION_CODE"
      ) {
        setFormError(error.response.data.message);
        pendingFocus.current = "form";
      } else if (!verificationRequested) {
        pendingFocus.current = "form";
        setFormError(
          isAxiosError<ApiErrorResponse>(error) &&
            [
              "IDENTITY_UNAVAILABLE",
              "EMAIL_UNAVAILABLE",
              "EMAIL_RATE_LIMITED",
              "EMAIL_DELIVERY_NOT_CONFIGURED",
              "EMAIL_SIGNUP_DISABLED",
            ].includes(error.response?.data?.code ?? "") &&
            typeof error.response?.data?.message === "string"
            ? error.response.data.message
            : isAxiosError(error) && error.response?.status === 429
              ? "Too many verification requests. Please wait and try again."
              : "We could not send your verification code. Check your connection and try again.",
        );
      } else {
        pendingFocus.current = "form";
        setFormError(
          isAxiosError(error) && error.response?.status === 429
            ? "Too many registration attempts. Please wait and try again."
            : isAxiosError(error) &&
                (!error.response || (error.response.status ?? 0) >= 500)
              ? "We couldn’t confirm account creation. Check your connection, then try signing in with these details before registering again."
              : "We couldn’t create your account. Please try again.",
        );
      }
      mutation.reset();
    } finally {
      setSendingCode(false);
      challenge.resetToken();
      submitting.current = false;
    }
  }

  async function resendCode() {
    if (
      !policy ||
      submitting.current ||
      (challenge.required && !challenge.token)
    )
      return;
    submitting.current = true;
    setSendingCode(true);
    setFormError("");
    try {
      const result = await requestEmailCode(
        fields.email.trim().toLowerCase(),
        policy,
        challenge.token || undefined,
      );
      setCodeMessage(result.message);
      setVerificationCode("");
      pendingFocus.current = "code";
    } catch (error: unknown) {
      const challengeMessage = challenge.handleError(error);
      const knownDeliveryCode =
        isAxiosError<ApiErrorResponse>(error) &&
        [
          "IDENTITY_UNAVAILABLE",
          "EMAIL_UNAVAILABLE",
          "EMAIL_RATE_LIMITED",
          "EMAIL_DELIVERY_NOT_CONFIGURED",
          "EMAIL_SIGNUP_DISABLED",
        ].includes(error.response?.data?.code ?? "");
      setFormError(
        challengeMessage ||
          (knownDeliveryCode &&
          typeof error.response?.data?.message === "string"
            ? error.response.data.message
            : "We could not send another code. Please wait and try again."),
      );
      pendingFocus.current = "form";
    } finally {
      setSendingCode(false);
      challenge.resetToken();
      submitting.current = false;
    }
  }

  return (
    <>
      <p className="sr-only" role="status">
        {pending ? "Creating your account. Please wait." : ""}
      </p>
      <form
        ref={formRef}
        className="registration-form auth-form-card registration-form--signup"
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        aria-busy={pending}
      >
        <ol
          className={`registration-steps ${method === "email" ? "registration-steps--compact" : ""}`}
          aria-label="Registration progress"
        >
          {(method === "google" ? [0, 2] : [0, 1, 2]).map((index, position) => (
            <li
              key={index}
              className={
                index === step
                  ? "is-current"
                  : index < step
                    ? "is-complete"
                    : undefined
              }
              aria-current={index === step ? "step" : undefined}
            >
              <span aria-hidden="true">
                {index < step ? <FiCheck /> : position + 1}
              </span>
              {["Details", "Password", "Confirm"][index]}
            </li>
          ))}
        </ol>
        <h2 className="registration-step-title" ref={stepHeading} tabIndex={-1}>
          {["Your details", "Set a password", "Confirm and continue"][step]}
        </h2>
        {step === 0 && (
          <>
            <div className="registration-name-row">
              {(["firstName", "lastName"] as const).map((field) => (
                <FormField
                  key={field}
                  id={field}
                  label={field === "firstName" ? "First name" : "Last name"}
                  error={errors[field]}
                  errorId={`${field}-error`}
                  required
                >
                  <Input
                    id={field}
                    name={field}
                    autoComplete={
                      field === "firstName" ? "given-name" : "family-name"
                    }
                    required
                    maxLength={ACCOUNT_LIMITS.nameMax}
                    value={fields[field]}
                    onChange={(event) => updateField(field, event.target.value)}
                    onBlur={() => validateField(field)}
                    disabled={mutation.isPending || sendingCode}
                    aria-invalid={Boolean(errors[field])}
                    aria-describedby={
                      errors[field] ? `${field}-error` : undefined
                    }
                  />
                </FormField>
              ))}
            </div>
            <FormField
              id="email"
              label="Email address"
              error={errors.email}
              errorId="email-error"
              required
            >
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
                disabled={pending}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
            </FormField>
            {onGoogleSuccess && import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={chooseGoogle}
              >
                Use Google instead
              </Button>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <FormField
              id="password"
              label="Password"
              error={errors.password}
              errorId="password-error"
              required
              hint={
                <>
                  Use {REGISTRATION_LIMITS.passwordMin}&ndash;
                  {REGISTRATION_LIMITS.passwordMax} characters.
                </>
              }
            >
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
                  onChange={(event) =>
                    updateField("password", event.target.value)
                  }
                  onBlur={() => validateField("password")}
                  disabled={pending}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={`password-hint${errors.password ? " password-error" : ""}`}
                />
                <Button
                  variant="ghost"
                  size="inherit"
                  className="password-toggle"
                  type="button"
                  aria-label={
                    showPasswords ? "Hide passwords" : "Show passwords"
                  }
                  aria-pressed={showPasswords}
                  aria-controls="password confirmPassword"
                  disabled={pending}
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
            <FormField
              id="confirmPassword"
              label="Confirm password"
              error={errors.confirmPassword}
              errorId="confirm-error"
              required
            >
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
                disabled={pending}
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={
                  errors.confirmPassword ? "confirm-error" : undefined
                }
              />
            </FormField>
          </>
        )}
        {step === 2 && (
          <>
            <RegistrationPolicyFields
              choices={policyChoices}
              disabled={pending}
              onChange={(choices) => {
                setPolicyChoices(choices);
                setFormError("");
              }}
            />
          </>
        )}
        {formError && !verificationOpen && (
          <InlineMessage ref={formErrorRef} tabIndex={-1}>
            {formError}
          </InlineMessage>
        )}
        {step === 2 &&
          method === "email" &&
          challenge.required &&
          !verificationOpen && (
            <BotChallenge
              key={challenge.version}
              action="register"
              onToken={challenge.onToken}
            />
          )}
        <div className="registration-step-actions">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => moveStep(method === "google" ? 0 : step - 1)}
            >
              Back
            </Button>
          )}
          {(step < 2 || method === "email") && (
            <Button
              ref={mainActionRef}
              variant="default"
              size="inherit"
              aria-busy={pending}
              className="primary-button"
              type="submit"
              disabled={
                pending ||
                (step === 2 && challenge.required && !challenge.token)
              }
            >
              {step < 2
                ? "Continue"
                : pending
                  ? "Creating account…"
                  : verificationRequested
                    ? "Continue verification"
                    : "Create account"}
              {pending ? (
                <FiLoader
                  className="button-icon is-spinning"
                  aria-hidden="true"
                />
              ) : (
                <FiArrowRight className="button-icon" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
        {step === 2 && method === "google" && onGoogleSuccess && (
          <GoogleSignIn
            policy={policy}
            names={{ firstName: fields.firstName, lastName: fields.lastName }}
            disabled={mutation.isPending || sendingCode}
            onSuccess={(session) => {
              navigationGuard.release();
              onGoogleSuccess(session);
            }}
          />
        )}
      </form>

      <Dialog
        open={verificationOpen}
        onOpenChange={(open) => {
          if (!pending) setVerificationOpen(open);
        }}
      >
        <DialogContent
          ref={verificationDialogRef}
          className="registration-verification-dialog"
          closeDisabled={pending}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            codeRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            mainActionRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <div className="registration-verification-title">
            <FiMail aria-hidden="true" />
            <DialogTitle>Verify your email</DialogTitle>
          </div>
          <DialogDescription className="registration-verification-description">
            Enter the code sent to <strong>{fields.email.trim()}</strong>
          </DialogDescription>
          <form
            className="registration-verification-form"
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              void submit(event, true);
            }}
          >
            <div className="registration-verification-body">
              <p className="sr-only" role="status">
                {pending ? "Creating your account. Please wait." : codeMessage}
              </p>
              <FormField
                id="verificationCode"
                label="Email verification code"
                required
              >
                <Input
                  ref={codeRef}
                  id="verificationCode"
                  name="verificationCode"
                  className="registration-code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter your code"
                  maxLength={8}
                  aria-describedby="verification-help"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  disabled={pending}
                />
              </FormField>
              <p
                id="verification-help"
                className="registration-verification-help"
              >
                Use the code from your latest email. Check spam if it
                hasn&apos;t arrived.
              </p>
              {formError && (
                <InlineMessage ref={formErrorRef} tabIndex={-1}>
                  {formError}
                </InlineMessage>
              )}
              {challenge.required && (
                <BotChallenge
                  key={challenge.version}
                  action="register"
                  onToken={challenge.onToken}
                />
              )}
              <div className="registration-verification-secondary">
                <Button
                  type="button"
                  variant="link"
                  className="registration-code-reset"
                  disabled={pending || (challenge.required && !challenge.token)}
                  onClick={() => {
                    void resendCode();
                  }}
                >
                  {sendingCode
                    ? "Sending another code..."
                    : "Request a new code"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  disabled={pending}
                  onClick={() => {
                    setVerificationOpen(false);
                    moveStep(0);
                  }}
                >
                  Edit details
                </Button>
              </div>
            </div>
            <footer className="registration-verification-actions">
              <Button
                type="submit"
                disabled={pending || (challenge.required && !challenge.token)}
                aria-busy={pending}
              >
                {mutation.isPending
                  ? "Creating account..."
                  : "Verify email and create account"}
                {mutation.isPending && (
                  <FiLoader className="is-spinning" aria-hidden="true" />
                )}
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
