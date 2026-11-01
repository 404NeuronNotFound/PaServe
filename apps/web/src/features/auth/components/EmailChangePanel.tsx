import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiCheck, FiClock, FiMail, FiShield } from "react-icons/fi";
import type {
  CurrentUser,
  EmailChangeStatus,
  ChangeEmailRequest,
} from "@paserve/contracts";
import { REGISTRATION_LIMITS } from "@paserve/contracts";
import { FormField } from "../../../components/forms/FormField";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { PendingButton } from "../../../components/feedback/PendingButton";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import { useSessionStore } from "../stores/session";
import { GoogleSignIn } from "./GoogleSignIn";
import {
  getEmailChange,
  changeEmail,
  confirmEmailChange,
  resendEmailChange,
  cancelEmailChange,
} from "../api/session";
function fieldError(error: unknown, field: string): string | undefined {
  return isAxiosError(error)
    ? error.response?.data?.fieldErrors?.[field]?.[0]
    : undefined;
}
function errorMessage(error: unknown) {
  return isAxiosError(error) &&
    typeof error.response?.data?.message === "string"
    ? error.response.data.message
    : "We could not update your email change. Please try again.";
}
type PanelProps = {
  user: CurrentUser;
  onCompleted: () => void;
  onBusyChange: (value: boolean) => void;
  onDirtyChange: (value: boolean) => void;
};
export function EmailChangePanel(props: PanelProps) {
  const token = useSessionStore((state) => state.accessToken);
  return token ? <EmailChangeEditor {...props} /> : null;
}
function EmailChangeEditor({
  user,
  onCompleted,
  onBusyChange,
  onDirtyChange,
}: PanelProps) {
  const client = useQueryClient();
  const key = ["email-change", user.id] as const;
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const query = useQuery({
    queryKey: key,
    queryFn: getEmailChange,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const pending = query.data?.pending ?? null;
  const save = (result: EmailChangeStatus) => {
    setNow(Date.now());
    return client.setQueryData(key, result);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
  };
  const unlock = () => {
    lock.current = false;
  };
  const begin = useMutation({
    mutationFn: (data: ChangeEmailRequest) => changeEmail(data),
    onSuccess: (result) => {
      save(result);
      setPassword("");
      setCode("");
    },
    onError: () => {
      setPassword("");
      refresh();
    },
    onSettled: unlock,
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (!pending) throw new Error("No pending change");
      return confirmEmailChange({
        id: pending.id,
        target: pending.currentConfirmed ? "new" : "current",
        code,
      });
    },
    onSuccess: (result) => {
      if (result.completed) onCompleted();
      else {
        save(result);
        setCode("");
        begin.reset();
        resend.reset();
        cancel.reset();
      }
    },
    onError: refresh,
    onSettled: unlock,
  });
  const resend = useMutation({
    mutationFn: () => {
      if (!pending) throw new Error("No pending change");
      return resendEmailChange({
        id: pending.id,
        target: pending.currentConfirmed ? "new" : "current",
      });
    },
    onSuccess: (result) => {
      save(result);
      setCode("");
      confirm.reset();
      begin.reset();
      cancel.reset();
    },
    onError: refresh,
    onSettled: unlock,
  });
  const cancel = useMutation({
    mutationFn: () => {
      if (!pending) throw new Error("No pending change");
      return cancelEmailChange(pending.id);
    },
    onSuccess: (result) => {
      save(result);
      setEmail(user.email);
      setPassword("");
      setCode("");
      begin.reset();
      confirm.reset();
      resend.reset();
    },
    onError: refresh,
    onSettled: unlock,
  });
  const busy =
    begin.isPending ||
    confirm.isPending ||
    resend.isPending ||
    cancel.isPending;
  const dirty = pending
    ? Boolean(code)
    : email !== user.email || Boolean(password);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  const pendingId = pending?.id;
  const currentConfirmed = pending?.currentConfirmed;
  useEffect(() => {
    if (!pendingId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    input.current?.focus();
    return () => window.clearInterval(timer);
  }, [pendingId, currentConfirmed]);
  const expired = pending
    ? new Date(pending.expiresAt).getTime() <= now
    : false;
  const wait = pending
    ? Math.max(
        0,
        Math.ceil((new Date(pending.resendAt).getTime() - now) / 1000),
      )
    : 0;
  const error = cancel.error ?? resend.error ?? confirm.error ?? begin.error;
  function start(credential?: string) {
    if (lock.current || busy) return Promise.resolve();
    if (
      !email.trim() ||
      email.trim().toLowerCase() === user.email.toLowerCase()
    )
      return Promise.reject(new Error("Enter a different email address."));
    lock.current = true;
    return begin
      .mutateAsync({
        email,
        ...(credential ? { credential } : { currentPassword: password }),
      })
      .then(() => {});
  }
  if (query.isPending)
    return <p role="status">Checking pending email changes...</p>;
  if (query.isError && !pending)
    return (
      <>
        <InlineMessage>{errorMessage(query.error)}</InlineMessage>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry email settings
        </Button>
      </>
    );
  return (
    <div className="email-change-panel">
      <dl className="email-change-summary">
        <div>
          <dt>
            <FiMail aria-hidden="true" /> Current sign-in email
          </dt>
          <dd>
            {user.email}
            {pending && (
              <span className="email-change-address-status">
                Active until you finish
              </span>
            )}
          </dd>
        </div>
        {pending && (
          <div>
            <dt>New email address</dt>
            <dd>
              {pending.email}
              <span className="email-change-address-status">
                Pending verification
              </span>
            </dd>
          </div>
        )}
      </dl>
      {pending ? (
        <form
          aria-label="Verify email change"
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current || expired) return;
            lock.current = true;
            confirm.mutate();
          }}
        >
          <fieldset disabled={busy}>
            <ol
              className="email-change-steps"
              aria-label="Email verification progress"
            >
              <li
                data-state={pending.currentConfirmed ? "complete" : "current"}
                aria-current={
                  !expired && !pending.currentConfirmed ? "step" : undefined
                }
              >
                <span className="email-change-step-number" aria-hidden="true">
                  {pending.currentConfirmed ? <FiCheck /> : "1"}
                </span>
                <span>
                  Current inbox
                  {pending.currentConfirmed && (
                    <span className="sr-only"> confirmed</span>
                  )}
                </span>
              </li>
              <li
                data-state={pending.currentConfirmed ? "current" : "upcoming"}
                aria-current={
                  !expired && pending.currentConfirmed ? "step" : undefined
                }
              >
                <span className="email-change-step-number" aria-hidden="true">
                  2
                </span>
                <span>New inbox</span>
              </li>
            </ol>
            <div className="email-change-stage">
              <p className="email-change-eyebrow">
                STEP {pending.currentConfirmed ? "2" : "1"} OF 2
              </p>
              <h3>
                {expired
                  ? "Your request has expired"
                  : pending.currentConfirmed
                    ? "Verify your new address"
                    : "Confirm your current inbox"}
              </h3>
              {!expired && (
                <p>
                  Enter the code we sent to{" "}
                  <strong>
                    {pending.currentConfirmed ? pending.email : user.email}
                  </strong>
                  .
                </p>
              )}
            </div>
            {expired ? (
              <InlineMessage>
                This request expired. Cancel it and start again.
              </InlineMessage>
            ) : (
              <FormField
                id="email-change-code"
                label={
                  pending.currentConfirmed
                    ? "New email verification code"
                    : "Current email verification code"
                }
                required
              >
                <Input
                  ref={input}
                  className="email-change-code"
                  id="email-change-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6,10}"
                  minLength={6}
                  maxLength={10}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    confirm.reset();
                  }}
                  required
                />
              </FormField>
            )}
            <div className="email-change-security-note">
              <FiShield aria-hidden="true" />
              <div>
                <p>
                  Your current email stays active until both inboxes are
                  confirmed.
                </p>
                <p>
                  {user.signInMethod === "google"
                    ? "Once complete, sign in again with your linked Google account."
                    : "Once complete, sign in again with your new email. Your password stays the same."}
                </p>
                <span>
                  <FiClock aria-hidden="true" /> Expires after 15 minutes. All
                  devices will be signed out.
                </span>
              </div>
            </div>
            {error && <InlineMessage>{errorMessage(error)}</InlineMessage>}
            {resend.isSuccess && (
              <InlineMessage tone="success" className="email-change-feedback">
                A new code was requested. Check the latest email.
              </InlineMessage>
            )}
            <div className="email-change-actions">
              {!expired && (
                <PendingButton
                  className="primary-button"
                  pending={confirm.isPending}
                  pendingLabel="Verifying..."
                  disabled={!code}
                >
                  {pending.currentConfirmed
                    ? "Verify and change email"
                    : "Confirm current inbox"}
                </PendingButton>
              )}
              {!expired && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || wait > 0}
                  onClick={() => {
                    if (lock.current) return;
                    lock.current = true;
                    resend.mutate();
                  }}
                >
                  {resend.isPending
                    ? "Requesting code..."
                    : wait > 0
                      ? "Resend code in " + wait + "s"
                      : "Resend code"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="email-change-cancel"
                disabled={busy}
                onClick={() => {
                  if (lock.current) return;
                  lock.current = true;
                  cancel.mutate();
                }}
              >
                Cancel email change
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <form
          aria-label="Change email"
          onSubmit={(event) => {
            event.preventDefault();
            void start().catch(() => {});
          }}
        >
          <fieldset disabled={busy}>
            <FormField id="profile-email" label="Email address" required>
              <Input
                id="profile-email"
                type="email"
                autoComplete="email"
                value={email}
                required
                maxLength={REGISTRATION_LIMITS.emailMax}
                onChange={(event) => {
                  setEmail(event.target.value);
                  begin.reset();
                }}
              />
            </FormField>
            {user.signInMethod === "google" ? (
              <>
                <p className="profile-form-hint">
                  Use your linked Google account to approve this request.
                  Changing your PaServe email does not change your Google
                  account.
                </p>
                <GoogleSignIn
                  disabled={
                    busy ||
                    email.trim().toLowerCase() === user.email.toLowerCase()
                  }
                  onReauthenticate={(credential) => start(credential)}
                />
                {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
                  <InlineMessage>
                    Google verification is unavailable. Contact support before
                    changing your email.
                  </InlineMessage>
                )}
              </>
            ) : (
              <FormField
                id="email-current-password"
                label="Current password for email change"
                error={fieldError(begin.error, "currentPassword")}
                required
              >
                <Input
                  id="email-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  maxLength={REGISTRATION_LIMITS.passwordMax}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FormField>
            )}
            <p className="profile-form-hint">
              We will verify your current inbox first, then your new inbox. Your
              current email stays active until you finish.
            </p>
            {error && <InlineMessage>{errorMessage(error)}</InlineMessage>}
            {user.signInMethod !== "google" && (
              <PendingButton
                className="primary-button"
                pending={begin.isPending}
                pendingLabel="Requesting code..."
                disabled={
                  email.trim().toLowerCase() === user.email.toLowerCase()
                }
              >
                Send verification code
              </PendingButton>
            )}
          </fieldset>
        </form>
      )}
    </div>
  );
}
