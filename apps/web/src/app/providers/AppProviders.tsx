import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FeedbackHost } from "../../components/feedback/FeedbackHost";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <FeedbackHost />
      {children}
    </QueryClientProvider>
  );
}
