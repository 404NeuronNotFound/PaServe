import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Fit device chrome to available space without changing the simulated menu width. */
export function DevicePreviewViewport({
  device,
  children,
}: {
  device: "phone" | "desktop";
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const model = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = viewport.current;
    const content = model.current;
    if (!host || !content) return;
    function fit() {
      if (!host || !content || !content.offsetWidth || !content.offsetHeight)
        return;
      const scale = Math.max(
        0,
        Math.min(
          1,
          host.clientWidth / content.offsetWidth,
          host.clientHeight / content.offsetHeight,
        ),
      );
      content.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
    fit();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(host);
    observer?.observe(content);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [device]);
  return (
    <div className="device-preview-viewport" ref={viewport}>
      <div className="device-preview-model" data-device={device} ref={model}>
        {children}
      </div>
    </div>
  );
}
