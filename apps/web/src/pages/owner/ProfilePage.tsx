import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import {
  FiUser,
  FiMail,
  FiLock,
  FiEye,
  FiEyeOff,
  FiShield,
} from "react-icons/fi";
import {
  ACCOUNT_LIMITS,
  REGISTRATION_LIMITS,
  type ApiErrorResponse,
  type CurrentUserResponse,
} from "@paserve/contracts";
import { AccountFrame } from "../../components/layout/AccountFrame";
import { FormField } from "../../components/forms/FormField";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { PendingButton } from "../../components/feedback/PendingButton";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { FormSkeleton } from "../../components/feedback/LoadingSkeleton";
import { feedback } from "../../app/stores/feedback";
import { useDraftGuard } from "../../app/router/useDraftGuard";
import {
  currentUserKey,
  getCurrentUser,
  updateProfile,
  changeEmail,
  changePassword,
} from "../../features/auth/api/session";
import "./profile.css";

function fieldError(error: unknown, field: string) {
  return isAxiosError<ApiErrorResponse>(error)
    ? error.response?.data.fieldErrors?.[field]?.[0]
    : undefined;
}
function message(error: unknown) {
  return isAxiosError<ApiErrorResponse>(error) &&
    typeof error.response?.data.message === "string"
    ? error.response.data.message
    : "We couldn’t save your changes. Please try again.";
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  error,
  newPassword = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FormField
      id={id}
      label={label}
      required
      error={error}
      hint={
        newPassword
          ? `Use ${REGISTRATION_LIMITS.passwordMin}–${REGISTRATION_LIMITS.passwordMax} characters.`
          : undefined
      }
    >
      <div className="profile-password-control">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={newPassword ? REGISTRATION_LIMITS.passwordMin : 1}
          maxLength={REGISTRATION_LIMITS.passwordMax}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
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

export function ProfilePage() {
  const releaseRef = useRef(() => {});
  const { data } = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    enabled: false,
  });
  return (
    <AccountFrame onSignedOut={() => releaseRef.current()}>
      {data ? (
        <ProfileEditor
          key={data.user.id}
          user={data.user}
          releaseRef={releaseRef}
        />
      ) : (
        <FormSkeleton label="Loading your profile…" />
      )}
    </AccountFrame>
  );
}

function ProfileEditor({
  user,
  releaseRef,
}: {
  user: CurrentUserResponse["user"];
  releaseRef: RefObject<() => void>;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    document.title = "Your profile · PaServe";
    heading.current?.focus();
  }, []);
  const profileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (profile) => {
      client.setQueryData<CurrentUserResponse>(currentUserKey, (old) =>
        old ? { user: { ...old.user, ...profile } } : old,
      );
      setFirstName(profile.firstName ?? "");
      setLastName(profile.lastName ?? "");
      setSaved(true);
      feedback.toast("Your profile has been updated.");
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const credentials = useMutation({
    mutationFn: (kind: "email" | "password") =>
      kind === "email"
        ? changeEmail({ email, currentPassword: emailPassword })
        : changePassword({ password, currentPassword }),
    onSuccess: (_result, kind) => {
      guard.release();
      setEmailPassword("");
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      feedback.clearTransient();
      feedback.toast(
        `${kind === "email" ? "Email" : "Password"} updated. Sign in again to continue.`,
      );
      client.clear();
      void navigate("/login", { replace: true });
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const busy = profileMutation.isPending || credentials.isPending;
  const profileDirty =
    firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "");
  const guard = useDraftGuard(
    profileDirty ||
      email !== user.email ||
      Boolean(emailPassword || currentPassword || password || confirmation),
    busy,
  );
  useLayoutEffect(() => {
    releaseRef.current = guard.release;
  }, [releaseRef, guard.release]);
  const emailError =
    credentials.variables === "email" ? credentials.error : null;
  const credentialError =
    credentials.variables === "password" ? credentials.error : null;
  function submitCredentials(kind: "email" | "password") {
    if (lock.current) return;
    setPasswordError("");
    if (
      kind === "password" &&
      (password !== confirmation || !/\S/u.test(password))
    ) {
      setPasswordError(
        password !== confirmation
          ? "Passwords do not match."
          : "Password must include a non-space character.",
      );
      document.getElementById("confirm-password")?.focus();
      return;
    }
    lock.current = true;
    credentials.mutate(kind);
  }
  return (
    <div className="profile-settings-page">
      <header className="page-header">
        <div>
          <p className="section-label">PERSONAL ACCOUNT</p>
          <h1 ref={heading} tabIndex={-1}>
            Your profile
          </h1>
          <p>Keep your details up to date and your account secure.</p>
        </div>
      </header>
      <div className="profile-settings-grid">
        <section
          className="profile-settings-card"
          aria-labelledby="personal-details-title"
        >
          <header className="profile-settings-heading">
            <span className="profile-settings-icon">
              <FiUser aria-hidden="true" />
            </span>
            <div>
              <h2 id="personal-details-title">Personal details</h2>
              <p>How you appear across your workspaces.</p>
            </div>
          </header>
          <form
            aria-label="Update personal details"
            onSubmit={(event) => {
              event.preventDefault();
              if (lock.current) return;
              lock.current = true;
              setSaved(false);
              profileMutation.mutate({ firstName, lastName });
            }}
          >
            <fieldset disabled={busy}>
              <FormField
                id="profile-first-name"
                label="First name"
                optional
                error={fieldError(profileMutation.error, "firstName")}
              >
                <Input
                  id="profile-first-name"
                  autoComplete="given-name"
                  value={firstName}
                  maxLength={ACCOUNT_LIMITS.nameMax}
                  onChange={(event) => {
                    setFirstName(event.target.value);
                    setSaved(false);
                  }}
                />
              </FormField>
              <FormField
                id="profile-last-name"
                label="Last name"
                optional
                error={fieldError(profileMutation.error, "lastName")}
              >
                <Input
                  id="profile-last-name"
                  autoComplete="family-name"
                  value={lastName}
                  maxLength={ACCOUNT_LIMITS.nameMax}
                  onChange={(event) => {
                    setLastName(event.target.value);
                    setSaved(false);
                  }}
                />
              </FormField>
              {profileMutation.isError && (
                <InlineMessage>{message(profileMutation.error)}</InlineMessage>
              )}
              {saved && (
                <InlineMessage tone="success">
                  Your details are saved.
                </InlineMessage>
              )}
              <PendingButton
                className="primary-button"
                pending={profileMutation.isPending}
                pendingLabel="Saving details…"
                disabled={!profileDirty}
              >
                Save details
              </PendingButton>
            </fieldset>
          </form>
          <dl className="profile-account-facts">
            <div>
              <dt>Sign-in email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>
                {new Intl.DateTimeFormat("en-PH", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone: "Asia/Manila",
                }).format(new Date(user.createdAt))}
              </dd>
            </div>
          </dl>
          <p className="profile-security-note">
            <FiShield aria-hidden="true" />
            Your account details apply to every shop you belong to.
          </p>
        </section>
        <div className="profile-security-stack">
          <section
            className="profile-settings-card"
            aria-labelledby="email-settings-title"
          >
            <header className="profile-settings-heading">
              <span className="profile-settings-icon">
                <FiMail aria-hidden="true" />
              </span>
              <div>
                <h2 id="email-settings-title">Sign-in email</h2>
                <p>Use an address you own and can access.</p>
              </div>
            </header>
            <form
              aria-label="Change email"
              onSubmit={(event) => {
                event.preventDefault();
                submitCredentials("email");
              }}
            >
              <fieldset disabled={busy}>
                <FormField
                  id="profile-email"
                  label="Email address"
                  required
                  error={fieldError(emailError, "email")}
                >
                  <Input
                    id="profile-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    required
                    maxLength={REGISTRATION_LIMITS.emailMax}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </FormField>
                <PasswordField
                  id="email-current-password"
                  label="Current password for email change"
                  value={emailPassword}
                  onChange={setEmailPassword}
                  error={fieldError(emailError, "currentPassword")}
                />
                <p className="profile-form-hint">
                  Changing your email signs you out on all devices. Sign in
                  again with the new address.
                </p>
                {emailError && (
                  <InlineMessage>{message(emailError)}</InlineMessage>
                )}
                <PendingButton
                  className="primary-button"
                  pending={
                    credentials.isPending && credentials.variables === "email"
                  }
                  pendingLabel="Updating email…"
                  disabled={
                    email.trim().toLowerCase() === user.email.toLowerCase()
                  }
                >
                  Update email
                </PendingButton>
              </fieldset>
            </form>
          </section>
          <section
            className="profile-settings-card"
            aria-labelledby="password-settings-title"
          >
            <header className="profile-settings-heading">
              <span className="profile-settings-icon">
                <FiLock aria-hidden="true" />
              </span>
              <div>
                <h2 id="password-settings-title">Password</h2>
                <p>Choose a strong password unique to PaServe.</p>
              </div>
            </header>
            <form
              aria-label="Change password"
              onSubmit={(event) => {
                event.preventDefault();
                submitCredentials("password");
              }}
            >
              <fieldset disabled={busy}>
                <PasswordField
                  id="account-current-password"
                  label="Current password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  error={fieldError(credentialError, "currentPassword")}
                />
                <PasswordField
                  id="account-new-password"
                  label="New password"
                  value={password}
                  onChange={setPassword}
                  newPassword
                  error={fieldError(credentialError, "password")}
                />
                <PasswordField
                  id="confirm-password"
                  label="Confirm new password"
                  value={confirmation}
                  onChange={(value) => {
                    setConfirmation(value);
                    setPasswordError("");
                  }}
                  newPassword
                  error={passwordError}
                />
                <p className="profile-form-hint">
                  Changing your password signs you out on all devices. Sign in
                  again with the new password.
                </p>
                {credentialError && (
                  <InlineMessage>{message(credentialError)}</InlineMessage>
                )}
                <PendingButton
                  className="primary-button"
                  pending={
                    credentials.isPending &&
                    credentials.variables === "password"
                  }
                  pendingLabel="Updating password…"
                >
                  Update password
                </PendingButton>
              </fieldset>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
