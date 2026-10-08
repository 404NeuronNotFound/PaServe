import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { currentUserKey, getCurrentUser } from "../api/session";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const session = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 0,
  });
  if (session.isPending)
    return (
      <main className="connection-page" role="status">
        Checking your session…
      </main>
    );
  if (session.isError) {
    if (isAxiosError(session.error) && session.error.response?.status === 401)
      return <Navigate to="/login" replace />;
    return (
      <main className="connection-page">
        <h1>Unable to check your session</h1>
        <p>Please check your connection and try again.</p>
        <button
          className="primary-button"
          onClick={() => {
            void session.refetch();
          }}
        >
          Try again
        </button>
      </main>
    );
  }
  return children;
}
