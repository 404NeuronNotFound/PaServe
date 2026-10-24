import { RefreshButton } from "./RefreshButton";
import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { InlineMessage } from "./InlineMessage";

class SectionBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <section className="daily-analytics refresh-recovery">
          <InlineMessage>
            We couldn’t load {this.props.label}. Other sections remain
            available.
          </InlineMessage>
          <RefreshButton label="Reload page"
            onClick={() => window.location.reload()}
          />
        </section>
      );
    return this.props.children;
  }
}

/** Mount optional work once it approaches the viewport, without gating siblings. */
export function DeferredSection({
  label,
  placeholder,
  children,
}: {
  label: string;
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const container = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  useEffect(() => {
    if (active && focusRequested.current) {
      focusRequested.current = false;
      container.current?.focus();
    }
  }, [active]);
  useEffect(() => {
    if (active || !container.current) return;
    let mounted = true;
    let observer: IntersectionObserver | undefined;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (mounted && entries.some((entry) => entry.isIntersecting)) {
            setActive(true);
            observer?.disconnect();
          }
        },
        { rootMargin: "240px 0px" },
      );
      observer.observe(container.current);
    } catch {
      // Older browsers must still receive the report, without requiring a click.
      queueMicrotask(() => {
        if (mounted) setActive(true);
      });
    }
    return () => {
      mounted = false;
      observer?.disconnect();
    };
  }, [active]);
  return (
    <div
      ref={container}
      tabIndex={-1}
      aria-label={label}
      data-deferred={active ? undefined : "true"}
    >
      {active ? (
        <SectionBoundary label={label}>
          <Suspense fallback={placeholder}>{children}</Suspense>
        </SectionBoundary>
      ) : (
        <>
          {placeholder}
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              focusRequested.current = true;
              setActive(true);
            }}
          >
            Load {label}
          </button>
        </>
      )}
    </div>
  );
}
