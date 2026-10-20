import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackHost } from "../../components/feedback/FeedbackHost";
import { ConnectionFeedback } from "../../components/feedback/ConnectionFeedback";
import { ViewportLayout } from "../../components/layout/ViewportLayout";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ViewportLayout />
      <FeedbackHost />
      <ConnectionFeedback />
      {children}
    </QueryClientProvider>
  );
}
