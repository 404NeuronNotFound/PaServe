import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import isEmail from "validator/lib/isEmail";
import { REGISTRATION_LIMITS, type ApiErrorResponse } from "@paserve/contracts";
import { FiArrowRight, FiEye, FiEyeOff, FiLoader } from "react-icons/fi";
import { FormField } from "../../../components/forms/FormField";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import {
  requestPasswordRecovery,
  resetRecoveredPassword,
} from "../api/password-recovery";
import { BotChallenge } from "./BotChallenge";
import { useBotChallenge } from "./useBotChallenge";

function RecoveryPassword({
  id,
  label,
  value,
  onChange,
  pending,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField id={id} label={label} required>
      <div className="password-input">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          aria-describedby={
            id === "recovery-password" ? "recovery-password-hint" : undefined
          }
          required
          minLength={REGISTRATION_LIMITS.passwordMin}
          maxLength={REGISTRATION_LIMITS.passwordMax}
          value={value}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          variant="ghost"
          size="inherit"
          className="password-toggle"
          disabled={pending}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <FiEyeOff aria-hidden="true" />
          ) : (
            <FiEye aria-hidden="true" />
          )}
        </Button>
      </div>
    </FormField>
  );
}

export function PasswordRecoveryForm() {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "done">("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const errorInput = useRef<HTMLParagraphElement>(null);
  const challenge = useBotChallenge();
  useEffect(() => {
    if (stage === "code") codeInput.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (error) errorInput.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function perform(reset: boolean) {
    if (lock.current || (challenge.required && !challenge.token)) return;
    const normalized = email.trim().toLowerCase();
    setError("");
    if (
      !isEmail(normalized) ||
      normalized.length > REGISTRATION_LIMITS.emailMax
    ) {
      setError("Enter a valid email address.");
      return;
    }
    if (
      reset &&
      (!/^\d{6,8}$/.test(code.trim()) ||
        password.length < REGISTRATION_LIMITS.passwordMin ||
        password.length > REGISTRATION_LIMITS.passwordMax ||
        !/\S/.test(password))
    ) {
      setError("Enter the email code and a password of 12 to 128 characters.");
      return;
    }
    if (reset && password !== confirmation) {
      setError("Your passwords do not match.");
      return;
    }
    lock.current = true;
    setPending(true);
    try {
      const response = reset
        ? await resetRecoveredPassword({
            email: normalized,
            code: code.trim(),
            password,
            ...(challenge.token ? { challengeToken: challenge.token } : {}),
          })
        : await requestPasswordRecovery(
            normalized,
            challenge.token || undefined,
          );
      setEmail(normalized);
      setMessage(response.message);
      if (reset) {
        setPassword("");
        setConfirmation("");
        setCode("");
        setStage("done");
      } else {
        setStage("code");
        setCooldown(60);
      }
    } catch (cause) {
      const security = challenge.handleError(cause);
      setError(
        security ||
          (isAxiosError<ApiErrorResponse>(cause) &&
          cause.response?.status === 429
            ? "Please wait before trying again."
            : isAxiosError<ApiErrorResponse>(cause) &&
                cause.response?.data.code === "INVALID_RECOVERY_CODE"
              ? "The code is incorrect, expired, or already used. Request a new reset code."
              : reset && isAxiosError(cause) && !cause.response
                ? "We couldn't confirm the result. Try signing in with your new password before requesting another code."
                : "Password recovery is temporarily unavailable. Check your connection and try again."),
      );
    } finally {
      lock.current = false;
      setPending(false);
      challenge.resetToken();
    }
  }

  if (stage === "done")
    return (
      <div className="auth-form-card registration-form">
        <InlineMessage tone="success">{message}</InlineMessage>
        <p className="auth-required-note">
          Your existing sessions have ended. Use your new password to sign in.
        </p>
        <Button asChild>
          <a href="/login">
            Sign in with new password <FiArrowRight aria-hidden="true" />
          </a>
        </Button>
      </div>
    );
  return (
    <form
      className="registration-form auth-form-card"
      noValidate
      aria-busy={pending}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void perform(stage === "code");
      }}
    >
      {message && <InlineMessage tone="info">{message}</InlineMessage>}
      {stage === "email" ? (
        <FormField id="recovery-email" label="Email address" required>
          <Input
            id="recovery-email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={REGISTRATION_LIMITS.emailMax}
            placeholder="you@example.com"
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
      ) : (
        <>
          <p className="auth-required-note">
            Resetting the password for <strong>{email}</strong>
          </p>
          <FormField id="recovery-code" label="Email reset code" required>
            <Input
              ref={codeInput}
              id="recovery-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={8}
              value={code}
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <RecoveryPassword
            id="recovery-password"
            label="New password"
            value={password}
            onChange={setPassword}
            pending={pending}
          />
          <p id="recovery-password-hint" className="login-session-hint">
            Use 12 to 128 characters. A longer passphrase works well.
          </p>
          <RecoveryPassword
            id="recovery-confirmation"
            label="Confirm new password"
            value={confirmation}
            onChange={setConfirmation}
            pending={pending}
          />
        </>
      )}
      {error && (
        <InlineMessage ref={errorInput} tabIndex={-1}>
          {error}
        </InlineMessage>
      )}
      {challenge.required && (
        <BotChallenge
          key={challenge.version}
          action="register"
          onToken={challenge.onToken}
        />
      )}
      <Button
        type="submit"
        disabled={pending || (challenge.required && !challenge.token)}
      >
        {pending
          ? "Please wait…"
          : stage === "email"
            ? "Send reset code"
            : "Reset password"}
        {pending ? (
          <FiLoader className="is-spinning" aria-hidden="true" />
        ) : (
          <FiArrowRight aria-hidden="true" />
        )}
      </Button>
      {stage === "code" && (
        <>
          <Button
            variant="outline"
            disabled={
              pending ||
              cooldown > 0 ||
              (challenge.required && !challenge.token)
            }
            onClick={() => {
              void perform(false);
            }}
          >
            {cooldown
              ? `Resend code in ${cooldown}s`
              : "Request a new reset code"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setStage("email");
              setCode("");
              setPassword("");
              setConfirmation("");
              setMessage("");
              setError("");
            }}
          >
            Use a different email
          </Button>
        </>
      )}
      <p className="login-session-hint">
        Signed up with Google? Continue with Google on the sign-in page.
      </p>
    </form>
  );
}
