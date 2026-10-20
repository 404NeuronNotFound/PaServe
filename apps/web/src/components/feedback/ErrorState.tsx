import { useId, useRef, type ReactNode } from "react";
import { InlineMessage } from "./InlineMessage";
import { PendingButton } from "./PendingButton";
import { describeRequestFailure } from "./request-failure";
import "./error-state.css";

export function ErrorState({ error, resource, pending = false, onRetry, retryLabel = "Retry",
  product, qr, permissionMessage, unavailableMessage, publicView = false, action = "refresh", notice, children }: {
  error: unknown;
  resource: string;
  pending?: boolean;
  onRetry?: () => unknown | Promise<unknown>;
  retryLabel?: string;
  product?: boolean;
  qr?: boolean;
  permissionMessage?: string;
  unavailableMessage?: string;
  publicView?: boolean;
  action?: "load" | "refresh";
  notice?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const running = useRef(false);
  const failure = describeRequestFailure(error, resource, { product, qr, permissionMessage, unavailableMessage, action, publicView });
  async function retry() {
    if (running.current || pending || !failure.retryable || !onRetry) return;
    running.current = true;
    try { await onRetry(); } catch { /* The caller owns the refreshed error state. */ }
    finally { running.current = false; }
  }
  return (
    <section className="error-state" aria-labelledby={id}>
      <h3 id={id}>{failure.title}</h3>
      <InlineMessage>{failure.message}{notice ? ` ${notice}` : ""}</InlineMessage>
      <div className="error-state-actions">
        {failure.retryable && onRetry && (
          <PendingButton type="button" className="secondary-button" pending={pending}
            pendingLabel={`Retrying ${resource}…`} onClick={() => void retry()}>{retryLabel}</PendingButton>
        )}
        {!publicView && failure.kind === "session" && <a className="secondary-button" href="/login">Sign in again</a>}
        {!publicView && (failure.kind === "permission" || failure.kind === "unavailable") && <a className="secondary-button" href="/app/shops">Choose another shop</a>}
        {children}
      </div>
    </section>
  );
}
