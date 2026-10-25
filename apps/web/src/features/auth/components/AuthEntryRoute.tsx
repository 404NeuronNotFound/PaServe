import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { isAxiosError } from "axios";
import { currentUserKey, getCurrentUser } from "../api/session";
import { AccessSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { SessionRecoveryPage } from "../../../components/feedback/SessionRecoveryPage";
import { signInDestination } from "../sign-in-destination";

/** Try the HttpOnly session cookie before asking for credentials again. */
export function AuthEntryRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });
  // Revalidate even if a previous account remains in the query cache.
  if (session.isPending || session.isFetching) {
    return (
      <main className="skeleton-session-page phase-two">
        <AccessSkeleton label="Restoring your session…" />
      </main>
    );
  }
  if (session.isSuccess) {
    return (
      <Navigate to={signInDestination(location.state?.returnTo)} replace />
    );
  }
  if (!isAxiosError(session.error) || session.error.response?.status !== 401) {
    return (
      <SessionRecoveryPage title="Unable to restore your session"
        pending={session.isFetching} onRetry={() => { void session.refetch(); }} />
    );
  }
  return children;
}
