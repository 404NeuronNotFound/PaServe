import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackHost } from "../../components/feedback/FeedbackHost";
import { ConnectionFeedback } from "../../components/feedback/ConnectionFeedback";
import { ViewportLayout } from "../../components/layout/ViewportLayout";
import { SessionSync } from "../../features/auth/components/SessionSync";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ViewportLayout />
      <SessionSync>
        <FeedbackHost />
        <ConnectionFeedback />
        {children}
      </SessionSync>
    </QueryClientProvider>
  );
}
