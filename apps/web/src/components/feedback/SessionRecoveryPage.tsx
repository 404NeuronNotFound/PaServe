import { useEffect, useRef } from "react";
import { FiRefreshCw, FiWifiOff } from "react-icons/fi";
import { RecoveryLayout } from "../layout/RecoveryLayout";
import { Button } from "../ui/button";
import { InlineMessage } from "./InlineMessage";
import "./session-recovery.css";

export function SessionRecoveryPage({ title, onRetry, pending = false }: {
  title: string; onRetry: () => void; pending?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · PaServe`;
    heading.current?.focus();
  }, [title]);
  return (
    <RecoveryLayout contentId="session-recovery-content">
      <main id="session-recovery-content" className="session-recovery-card" tabIndex={-1}
        aria-labelledby="session-recovery-title">
        <div className="session-recovery-copy">
          <p className="section-label">YOUR ACCOUNT · CONNECTION CHECK</p>
          <h1 id="session-recovery-title" ref={heading} tabIndex={-1}>{title}</h1>
          <p className="session-recovery-description">We couldn’t confirm your session. Check your connection, then try again to pick up where you left off.</p>
          <InlineMessage tone="warning">Your session may still be valid. We’ll check it again before continuing.</InlineMessage>
          <div className="session-recovery-actions">
            <Button size="lg" type="button" disabled={pending} aria-busy={pending} onClick={onRetry}>
              <FiRefreshCw aria-hidden="true" />{pending ? "Checking…" : "Try again"}
            </Button>
            {pending && <span role="status">Checking your session…</span>}
          </div>
          <p className="session-recovery-help">If this keeps happening, check that your internet connection is working and try again in a moment.</p>
        </div>
        <div className="session-recovery-art" aria-hidden="true">
          <span className="session-recovery-orbit" />
          <span className="session-recovery-symbol"><FiWifiOff /></span>
          <p>Let’s reconnect.</p>
        </div>
      </main>
    </RecoveryLayout>
  );
}
