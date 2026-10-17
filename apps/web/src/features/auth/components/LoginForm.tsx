import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import isEmail from "validator/lib/isEmail";
import { FiArrowRight, FiEye, FiEyeOff, FiLoader } from "react-icons/fi";
import type { ApiErrorResponse, LoginResponse } from "@paserve/contracts";
import { REGISTRATION_LIMITS } from "@paserve/contracts";
import { loginAccount } from "../api/session";
import { InlineMessage } from "../../../components/feedback/InlineMessage";

export function LoginForm({
  onSuccess,
  initialEmail = "",
}: {
  onSuccess: (session: LoginResponse) => void;
  initialEmail?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [formError, setFormError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const pendingFocus = useRef<"email" | "password" | "form" | null>(null);
  const touched = useRef({ email: false, password: false });
  const mutation = useMutation({
    mutationFn: loginAccount,
    retry: false,
    gcTime: 0,
  });
  const emailError = (value: string) =>
    !isEmail(value.trim()) || value.trim().length > REGISTRATION_LIMITS.emailMax
      ? "Enter a valid email address."
      : undefined;
  const passwordError = (value: string) =>
    !value ? "Enter your password." : undefined;

  useEffect(() => {
    if (!mutation.isPending && pendingFocus.current) {
      const ref =
        pendingFocus.current === "email"
          ? emailRef
          : pendingFocus.current === "password"
            ? passwordRef
            : errorRef;
      ref.current?.focus();
      pendingFocus.current = null;
    }
  }, [errors, formError, mutation.isPending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    touched.current = { email: true, password: true };
    const nextErrors = {
      email: emailError(email),
      password: passwordError(password),
    };
    setErrors(nextErrors);
    setFormError("");
    if (nextErrors.email || nextErrors.password) {
      pendingFocus.current = nextErrors.email ? "email" : "password";
      return;
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync({
        email: email.trim().toLowerCase(),
        password,
      });
      setPassword("");
      mutation.reset();
      onSuccess(result);
    } catch (error: unknown) {
      if (
        isAxiosError<ApiErrorResponse>(error) &&
        error.response?.status === 400
      ) {
        const fields = error.response.data.fieldErrors;
        setErrors({
          email: fields?.email?.[0],
          password: fields?.password?.[0],
        });
        setFormError("Please check your email and password.");
        pendingFocus.current = fields?.email?.length
          ? "email"
          : fields?.password?.length
            ? "password"
            : "form";
      } else {
        setFormError(
          isAxiosError(error) && error.response?.status === 401
            ? "Email or password is incorrect, or the account is unavailable."
            : isAxiosError(error) && error.response?.status === 429
              ? "Too many sign-in attempts. Please wait a minute and try again."
              : "We couldn’t sign you in. Please try again.",
        );
        pendingFocus.current = "form";
      }
      mutation.reset();
    } finally {
      submitting.current = false;
    }
  }

  return (
    <>
      <p className="sr-only" role="status">
        {mutation.isPending ? "Signing you in. Please wait." : ""}
      </p>
      <form
        className="registration-form"
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="field">
          <label htmlFor="login-email">Email address</label>
          <input
            ref={emailRef}
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            required
            maxLength={REGISTRATION_LIMITS.emailMax}
            placeholder="you@example.com"
            value={email}
            disabled={mutation.isPending}
            onChange={(event) => {
              setEmail(event.target.value);
              setFormError("");
              if (touched.current.email)
                setErrors((current) => ({
                  ...current,
                  email: emailError(event.target.value),
                }));
            }}
            onBlur={() => {
              touched.current.email = true;
              setErrors((current) => ({
                ...current,
                email: emailError(email),
              }));
            }}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "login-email-error" : undefined}
          />
          {errors.email && (
            <InlineMessage className="field-error" id="login-email-error">
              {errors.email}
            </InlineMessage>
          )}
        </div>
        <div className="field">
          <label htmlFor="login-password">Password</label>
          <div className="password-input">
            <input
              ref={passwordRef}
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={REGISTRATION_LIMITS.passwordMax}
              value={password}
              disabled={mutation.isPending}
              onChange={(event) => {
                setPassword(event.target.value);
                setFormError("");
                if (touched.current.password)
                  setErrors((current) => ({
                    ...current,
                    password: passwordError(event.target.value),
                  }));
              }}
              onBlur={() => {
                touched.current.password = true;
                setErrors((current) => ({
                  ...current,
                  password: passwordError(password),
                }));
              }}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={
                errors.password ? "login-password-error" : undefined
              }
            />
            <button
              className="password-toggle"
              type="button"
              disabled={mutation.isPending}
              aria-label={visible ? "Hide password" : "Show password"}
              aria-pressed={visible}
              aria-controls="login-password"
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? (
                <FiEyeOff aria-hidden="true" />
              ) : (
                <FiEye aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && (
            <InlineMessage className="field-error" id="login-password-error">
              {errors.password}
            </InlineMessage>
          )}
        </div>
        {formError && (
          <InlineMessage ref={errorRef} tabIndex={-1}>
            {formError}
          </InlineMessage>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Signing in…" : "Sign in"}
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
