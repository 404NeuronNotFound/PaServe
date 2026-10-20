import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo, FiX } from "react-icons/fi";
import {
  useFeedbackStore,
  type BannerNotice,
  type TransientNotice,
} from "../../app/stores/feedback";
import { InlineMessage } from "./InlineMessage";
import { PendingButton } from "./PendingButton";
import { pendingActionLabel } from "./pending-action-label";

export function Banner({
  message,
  tone = "warning",
  onDismiss,
}: {
  message: string;
  tone?: BannerNotice["tone"];
  onDismiss: () => void;
}) {
  const Icon = tone === "info" ? FiInfo : FiAlertCircle;
  return (
    <section
      className={`feedback-banner feedback-${tone}`}
      aria-label="Important notice"
    >
      <p role={tone === "info" ? "status" : "alert"}>
        <Icon aria-hidden="true" />
        <span>{message}</span>
      </p>
      <button
        className="feedback-dismiss"
        type="button"
        aria-label="Dismiss notice"
        onClick={onDismiss}
      >
        <FiX aria-hidden="true" />
      </button>
    </section>
  );
}

function TransientMessage({
  notice,
  dismiss,
  obscured,
}: {
  notice: TransientNotice;
  dismiss: (id: number) => void;
  obscured: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const remaining = useRef(notice.duration);
  const paused = hovered || focused || hidden || pending || obscured;
  useLayoutEffect(() => {
    const node = container.current;
    const previousFocus = document.activeElement;
    return () => {
      if (
        node?.contains(document.activeElement) &&
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected
      )
        previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timeout = window.setTimeout(
      () => dismiss(notice.id),
      remaining.current,
    );
    return () => {
      window.clearTimeout(timeout);
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started),
      );
    };
  }, [paused, dismiss, notice.id]);

  async function runAction() {
    if (notice.kind !== "snackbar" || running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      await notice.action.onClick();
      dismiss(notice.id);
    } catch (failure) {
      setError(
        notice.action.errorMessage?.(failure) ??
          "The action could not be completed. Please try again.",
      );
      // A failed action needs time to recover rather than disappearing immediately.
      remaining.current = notice.duration;
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  const Icon = notice.tone === "success" ? FiCheckCircle : FiInfo;
  return (
    <div
      ref={container}
      className={`feedback-transient feedback-${notice.kind}`}
      aria-busy={pending}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <p role="status" aria-atomic="true">
        <Icon aria-hidden="true" />
        <span>{notice.message}</span>
      </p>
      {notice.kind === "snackbar" && (
        <PendingButton
          className="feedback-action"
          pending={pending}
          pendingLabel={pendingActionLabel(notice.action.label)}
          type="button"
          disabled={pending}
          onClick={() => {
            void runAction();
          }}
        >
          {notice.action.label}
        </PendingButton>
      )}
      <button
        className="feedback-dismiss"
        type="button"
        disabled={pending}
        aria-label="Dismiss message"
        onClick={() => dismiss(notice.id)}
      >
        <FiX aria-hidden="true" />
      </button>
      {error && (
        <InlineMessage className="feedback-action-error">{error}</InlineMessage>
      )}
    </div>
  );
}

export function FeedbackHost() {
  const { notices, banners, dismiss, dismissBanner } = useFeedbackStore();
  const [modalOpen, setModalOpen] = useState(() => Boolean(document.querySelector("dialog[open]")));
  useEffect(() => {
    let active = true;
    const update = () => {
      if (active) setModalOpen(Boolean(document.querySelector("dialog[open]")));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    queueMicrotask(update);
    return () => { active = false; observer.disconnect(); };
  }, []);
  const bannerArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const area = bannerArea.current;
    if (!area) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--feedback-banner-height",
        `${area.getBoundingClientRect().height}px`,
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(area);
    return () => {
      observer?.disconnect();
      document.documentElement.style.removeProperty("--feedback-banner-height");
    };
  }, [banners]);
  return (
    <>
      <div className="feedback-banners" ref={bannerArea}>
        {banners.map((banner) => (
          <Banner
            key={banner.id}
            message={banner.message}
            tone={banner.tone}
            onDismiss={() => dismissBanner(banner.key)}
          />
        ))}
      </div>
      <div className="feedback-overlay" aria-label="Status updates" hidden={modalOpen}>
        {notices[0] && (
          <TransientMessage
            key={notices[0].id}
            notice={notices[0]}
            dismiss={dismiss}
            obscured={modalOpen}
          />
        )}
      </div>
    </>
  );
}
