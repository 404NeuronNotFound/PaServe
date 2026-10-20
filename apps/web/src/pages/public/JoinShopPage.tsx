import { Button } from "../../components/ui/button";
import { PendingButton } from "../../components/feedback/PendingButton";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { ApiErrorResponse } from "@paserve/contracts";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { AccessSkeleton } from "../../components/feedback/LoadingSkeleton";
import { LoginForm } from "../../features/auth/components/LoginForm";
import { RegistrationForm } from "../../features/auth/components/RegistrationForm";
import { getCurrentUser, logoutAccount } from "../../features/auth/api/session";
import {
  acceptInvitation,
  previewInvitation,
} from "../../features/shops/api/staff";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";
import { canUseCashier } from "../../features/cashier/access";

export function JoinShopPage() {
  const { shopId = "" } = useParams();
  const location = useLocation();
  // The credential stays in the URL fragment and memory, never localStorage.
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  return (
    <JoinInvitation key={`${shopId}:${token}`} shopId={shopId} token={token} />
  );
}
function JoinInvitation({ shopId, token }: { shopId: string; token: string }) {
  const valid =
    /^[0-9a-f]{64}$/.test(token) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      shopId,
    );
  const client = useQueryClient();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [register, setRegister] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"accept" | "switch" | null>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  // Isolate credentials without putting the invitation token in query keys.
  const invitationId = useId();
  const session = useQuery({
    queryKey: ["invitation-session", invitationId, attempt],
    queryFn: getCurrentUser,
    enabled: valid,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
  });
  const preview = useQuery({
    queryKey: [
      "invitation-preview",
      invitationId,
      session.data?.user.id,
      shopId,
      attempt,
    ],
    queryFn: ({ signal }) => previewInvitation(shopId, token, signal),
    enabled: valid && session.isSuccess && !session.isFetching,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
  });
  useEffect(() => {
    mounted.current = true;
    document.title = "Join your shop · PaServe";
    return () => {
      mounted.current = false;
    };
  }, []);
  const anonymous =
    isAxiosError(session.error) && session.error.response?.status === 401;
  async function accept() {
    if (
      running.current ||
      !session.isSuccess ||
      session.isFetching ||
      !preview.isSuccess ||
      preview.isFetching
    )
      return;
    running.current = true;
    setBusy(true);
    setPendingAction("accept");
    setError("");
    try {
      const result = await acceptInvitation(shopId, token);
      if (!mounted.current) return;
      client.clear();
      feedback.toast("You have joined the shop.");
      void navigate(
        `/app/shops/${encodeURIComponent(shopId)}${canUseCashier(result.role) ? "/cashier" : ""}`,
        { replace: true },
      );
    } catch (failure) {
      if (mounted.current)
        setError(
          isAxiosError<ApiErrorResponse>(failure)
            ? (failure.response?.data.message ??
                "Unable to accept the invitation. Please try again.")
            : "Unable to accept the invitation. Please try again.",
        );
      if (isAxiosError(failure) && failure.response?.status === 401)
        void session.refetch();
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function switchAccount() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setPendingAction("switch");
    setError("");
    try {
      await logoutAccount();
      if (mounted.current) {
        client.clear();
        setAttempt((value) => value + 1);
      }
    } catch {
      if (mounted.current) setError("Unable to sign out. Please try again.");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <AuthLayout headingId="join-heading">
      <p className="section-label">STAFF INVITATION</p>
      <h1 id="join-heading">Join your shop</h1>
      {!valid ? (
        <>
          <InlineMessage>
            This invitation link is incomplete or invalid. Ask the shop owner
            for a new link.
          </InlineMessage>
          <Link to="/login">Go to sign in</Link>
        </>
      ) : session.isPending || session.isFetching ? (
        <AccessSkeleton label="Checking your session…" view="invitation" />
      ) : session.isSuccess ? (
        <>
          <p>
            Signed in as <strong>{session.data.user.email}</strong>.
          </p>
          {preview.isPending || preview.isFetching ? (
            <AccessSkeleton label="Checking your invitation…" view="invitation" />
          ) : preview.isError ? (
            <>
              <InlineMessage>
                {isAxiosError<ApiErrorResponse>(preview.error)
                  ? (preview.error.response?.data.message ??
                    "Unable to check the invitation. Please try again.")
                  : "Unable to check the invitation. Please try again."}
              </InlineMessage>
              <Button variant="outline" size="inherit" type="submit"
                className="secondary-button"
                onClick={() => void preview.refetch()}
                disabled={busy}
              >
                Check invitation again
              </Button>
            </>
          ) : (
            <p>
              You are invited to join <strong>{preview.data.shopName}</strong>{" "}
              as{" "}
              <strong>
                {preview.data.role === "KITCHEN"
                  ? "kitchen / barista"
                  : preview.data.role.toLowerCase()}
              </strong>
              .
            </p>
          )}
          {error && <InlineMessage>{error}</InlineMessage>}
          <PendingButton
            pending={busy && pendingAction === "accept"}
            pendingLabel="Joining shop..."
            className="primary-button"
            onClick={() => void accept()}
            disabled={busy || !preview.isSuccess || preview.isFetching}
          >
            Accept invitation
          </PendingButton>
          <PendingButton
            pending={busy && pendingAction === "switch"}
            pendingLabel="Signing out..."
            className="secondary-button"
            onClick={() => void switchAccount()}
            disabled={busy}
          >
            Use another account
          </PendingButton>
        </>
      ) : !anonymous ? (
        <>
          <InlineMessage>
            Unable to check your session. Check your connection and try again.
          </InlineMessage>
          <Button variant="default" size="inherit" type="submit"
            className="primary-button"
            onClick={() => void session.refetch()}
          >
            Try again
          </Button>
        </>
      ) : (
        <>
          <p className="form-intro">
            {register
              ? "Create your account using the email address your owner invited."
              : "Sign in using the email address your owner invited."}
          </p>
          <p className="account-note">
            Use your own password. The shop owner never needs your password.
          </p>
          {error && <InlineMessage tone="info">{error}</InlineMessage>}
          {register ? (
            <RegistrationForm
              onSuccess={({ user }) => {
                setRegisteredEmail(user.email);
                setRegister(false);
                setError(
                  "Your account is ready. Sign in below to accept the invitation.",
                );
              }}
            />
          ) : (
            <LoginForm
              initialEmail={registeredEmail}
              onSuccess={() => {
                client.clear();
                setAttempt((value) => value + 1);
                setError("");
              }}
            />
          )}
          <p className="account-note">
            <Button variant="outline" size="inherit" type="submit"
              className="secondary-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register
                ? "Already have an account? Sign in"
                : "New to PaServe? Create an account"}
            </Button>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
