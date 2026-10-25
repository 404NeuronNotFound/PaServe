import { SessionRecoveryPage } from "../../../components/feedback/SessionRecoveryPage";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { isAxiosError } from "axios";
import { currentUserKey, getCurrentUser } from "../api/session";
import { AccessSkeleton } from "../../../components/feedback/LoadingSkeleton";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const cashierRequest = /^\/app\/shops\/[^/]+\/cashier(?:\/|$)/.test(
    location.pathname,
  );
  const session = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 0,
    networkMode: "always",
  });
  // Cashier tools fail closed during revalidation. Other workspaces preserve
  // their existing draft behavior during a background session check.
  if (session.isPending || (cashierRequest && session.isFetching))
    return (
      <main className="skeleton-session-page phase-two">
        <AccessSkeleton
          label="Checking your session…"
          view={
            cashierRequest
              ? "cashier"
              : /\/kitchen(?:\/|$)/.test(location.pathname)
                ? "kitchen"
                : "workspace"
          }
        />
      </main>
    );
  if (session.isError) {
    if (isAxiosError(session.error) && session.error.response?.status === 401)
      return (
        <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
      );
    return (
      <SessionRecoveryPage title="Unable to check your session"
        pending={session.isFetching} onRetry={() => { void session.refetch(); }} />
    );
  }
  return children;
}
