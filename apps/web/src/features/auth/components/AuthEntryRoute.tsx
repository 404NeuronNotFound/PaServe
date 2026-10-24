import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { isAxiosError } from "axios";
import { currentUserKey, getCurrentUser } from "../api/session";
import { AccessSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import { Button } from "../../../components/ui/button";
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
      <main className="connection-page">
        <h1>Unable to restore your session</h1>
        <InlineMessage>
          Check your connection and try again. Your session may still be valid.
        </InlineMessage>
        <Button
          onClick={() => {
            void session.refetch();
          }}
        >
          Try again
        </Button>
      </main>
    );
  }
  return children;
}
