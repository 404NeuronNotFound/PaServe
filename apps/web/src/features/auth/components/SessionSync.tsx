import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSessionStore } from "../stores/session";
import { listenForSignOut } from "../api/session-events";
import { feedback } from "../../../app/stores/feedback";
import { Button } from "../../../components/ui/button";

/** Unmount private screens immediately, including screens with unsaved-route blockers. */
export function SessionSync({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const ended = useSessionStore((state) => state.signedOutElsewhere);
  useEffect(
    () =>
      listenForSignOut(() => {
        useSessionStore.getState().endSession(true);
        void client.cancelQueries();
        client.clear();
        feedback.clearTransient();
      }),
    [client],
  );
  if (
    ended &&
    /^\/(app(?:\/|$)|login(?:\/|$)|register(?:\/|$))/.test(
      window.location.pathname,
    )
  ) {
    return (
      <main className="connection-page">
        <h1>You’ve been signed out</h1>
        <p>Your session ended in another tab. Sign in again to continue.</p>
        <Button asChild>
          <a href="/login">Sign in again</a>
        </Button>
      </main>
    );
  }
  return children;
}
