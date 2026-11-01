import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import type { LoginResponse } from "@paserve/contracts";
import { googleAccount } from "../api/session";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../../lib/api/client";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import { Button } from "../../../components/ui/button";

type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential: string }) => void;
    auto_select: boolean;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: string; size: string; text: string },
  ): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let scriptPromise: Promise<void> | undefined;
function loadGoogle() {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        scriptPromise = undefined;
        reject(new Error("Could not load Google."));
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}

export function GoogleSignIn({
  names,
  keepSignedIn = false,
  disabled = false,
  onSuccess,
}: {
  names?: { firstName: string; lastName: string };
  keepSignedIn?: boolean;
  disabled?: boolean;
  onSuccess: (session: LoginResponse) => void;
}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ names, keepSignedIn, onSuccess, disabled });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    latest.current = { names, keepSignedIn, onSuccess, disabled };
  });
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    void (async () => {
      try {
        await loadGoogle();
        const { data } = await api.post<{ nonce: string }>(
          "/auth/google/challenge",
          {},
          {
            headers: { "X-PaServe-Client": "web" },
            timeout: AUTH_REQUEST_TIMEOUT_MS,
          },
        );
        if (!active || !container.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce: data.nonce,
          auto_select: false,
          callback: (response) => {
            if (!active || busy.current || latest.current.disabled) return;
            const current = latest.current;
            if (
              current.names &&
              (!current.names.firstName.trim() ||
                !current.names.lastName.trim())
            ) {
              setError(
                "Enter your first and last names before continuing with Google.",
              );
              return;
            }
            busy.current = true;
            setPending(true);
            setError("");
            void googleAccount({
              credential: response.credential,
              ...(current.names
                ? {
                    firstName: current.names.firstName.trim(),
                    lastName: current.names.lastName.trim(),
                  }
                : { keepSignedIn: current.keepSignedIn }),
            })
              .then((session) => {
                if (active) current.onSuccess(session);
              })
              .catch((err: unknown) => {
                if (active)
                  setError(
                    isAxiosError(err) &&
                      typeof err.response?.data?.message === "string"
                      ? err.response.data.message
                      : "Google sign-in failed. Please try again.",
                  );
              })
              .finally(() => {
                busy.current = false;
                if (active) setPending(false);
              });
          },
        });
        container.current.replaceChildren();
        window.google.accounts.id.renderButton(container.current, {
          theme: "outline",
          size: "large",
          text: latest.current.names ? "signup_with" : "signin_with",
        });
      } catch {
        if (active)
          setError("Google sign-in is unavailable. Try again or use email.");
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId, retry]);
  if (!clientId) return null;
  return (
    <div className="google-auth" aria-busy={pending}>
      <p className="account-note">
        {names
          ? "Use your verified Google account"
          : "Or sign in with your verified Google account"}
      </p>
      <div ref={container} hidden={pending || disabled} />
      {pending && <p role="status">Signing in with Google?</p>}
      {error && (
        <>
          <InlineMessage>{error}</InlineMessage>
          <Button
            type="button"
            variant="outline"
            disabled={pending || disabled}
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            Retry Google sign-in
          </Button>
        </>
      )}
    </div>
  );
}
