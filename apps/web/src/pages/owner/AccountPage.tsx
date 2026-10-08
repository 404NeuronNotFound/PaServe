import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey, logoutAccount } from "../../features/auth/api/session";

export function AccountPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const user = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Your account · PaServe";
    heading.current?.focus();
  }, []);
  const logout = useMutation({
    mutationFn: logoutAccount,
    retry: false,
    onSuccess: () => {
      client.clear();
      void navigate("/login", { replace: true });
    },
  });
  return (
    <main className="connection-page">
      <p className="section-label">PaServe account</p>
      <h1 ref={heading} tabIndex={-1}>
        You’re signed in
      </h1>
      <p>{user?.email}</p>
      <p>Your account is ready. Shop setup comes next.</p>
      {logout.isError && (
        <p className="form-error" role="alert">
          We couldn’t sign you out. Please try again.
        </p>
      )}
      <button
        className="primary-button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
