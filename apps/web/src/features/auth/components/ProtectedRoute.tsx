import { SessionRecoveryPage } from "../../../components/feedback/SessionRecoveryPage";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { isAxiosError } from "axios";
import { currentUserKey, getCurrentUser } from "../api/session";
import { AccessSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { AccessGate } from "./AccessGate";
import {
  accessRevalidation,
  useAccessDenial,
  useAccessOnline,
  useDiscardAccessCache,
  useEndRevokedSession,
  useRecentAccess,
} from "../access-revalidation";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const client = useQueryClient();
  const online = useAccessOnline();
  const session = useQuery({
    queryKey: currentUserKey,
    queryFn: getCurrentUser,
    retry: false,
    staleTime: 0,
    networkMode: "always",
    refetchOnMount: "always",
    ...accessRevalidation,
  });
  const status = useAccessDenial(
    "session",
    isAxiosError(session.error) ? session.error.response?.status : undefined,
  );
  const denied = status !== undefined;
  const recent = useRecentAccess(session.dataUpdatedAt);
  useEndRevokedSession(denied);
  useDiscardAccessCache(client, denied);
  if (denied)
    return (
      <Navigate to="/login" replace state={{ returnTo: location.pathname }} />
    );
  const pending = session.isPending || session.isFetching;
  const view = /\/cashier(?:\/|$)/.test(location.pathname)
    ? "cashier"
    : /\/kitchen(?:\/|$)/.test(location.pathname)
      ? "kitchen"
      : "workspace";
  const fallback =
    pending && online ? (
      <main className="skeleton-session-page phase-two">
        <AccessSkeleton label="Checking your session…" view={view} />
      </main>
    ) : (
      <SessionRecoveryPage
        title="Unable to check your session"
        preserveTitle={Boolean(session.data)}
        pending={session.isFetching}
        onRetry={() => {
          void session.refetch();
        }}
      />
    );
  return (
    <AccessGate
      key={session.data?.user.id ?? "session"}
      allowed={
        online && session.isSuccess && recent && session.isFetchedAfterMount
      }
      pending={pending && online}
      fallback={fallback}
      label="Checking your session…"
    >
      {children}
    </AccessGate>
  );
}
