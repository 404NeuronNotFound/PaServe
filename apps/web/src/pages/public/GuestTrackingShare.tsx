import { useEffect, useRef, useState } from "react";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import {
  trackingApiUrl,
  trackingPath,
} from "../../features/orders/guest-tracking";
import { parseOrderQrToken } from "../../features/orders/order-qr-reference";

export function GuestTrackingShare({
  shopSlug,
  orderId,
  orderNumber,
}: {
  shopSlug: string;
  orderId: string;
  orderNumber: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function share(qr: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    const timeout = setTimeout(() => controller.current?.abort(), 15_000);
    try {
      const path = trackingPath(shopSlug, orderId);
      const response = await fetch(trackingApiUrl(`${path}/tracking-link`), {
        credentials: "include",
        cache: "no-store",
        signal: controller.current.signal,
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Unavailable");
      const data: { trackingToken?: unknown } = await response.json();
      if (
        typeof data.trackingToken !== "string" ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(data.trackingToken)
      )
        throw new Error("Invalid link");
      const reference = parseOrderQrToken(data.trackingToken, "order-tracking");
      if (
        !reference ||
        reference.orderId !== orderId ||
        reference.expiresAt <= Date.now()
      )
        throw new Error("Invalid link");
      const link = `${window.location.origin}${path}#tracking=${encodeURIComponent(data.trackingToken)}`;
      if (!active.current) return;
      if (qr) {
        const { default: QRCode } = await import("qrcode");
        if (!active.current) return;
        const svg = await QRCode.toString(link, {
          type: "svg",
          margin: 4,
          errorCorrectionLevel: "M",
        });
        if (active.current)
          setImage(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          );
      } else {
        await navigator.clipboard.writeText(link);
        if (active.current) feedback.toast("Private tracking link copied.");
      }
    } catch {
      if (active.current)
        setError(
          "Unable to share tracking. Try again, or ask the counter staff for help using your order number.",
        );
    } finally {
      clearTimeout(timeout);
      if (active.current) setBusy(false);
    }
  }
  return (
    <details
      className="guest-tracking-share"
      onToggle={(event) => {
        if (!event.currentTarget.open) setImage(null);
      }}
    >
      <summary>Track on another device</summary>
      <p className="order-receipt-note">
        Anyone with this private link or QR can view this order until access
        expires. For cashier verification, use your order number or the separate
        order QR.
      </p>
      <div className="order-receipt-footer-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void share(false)}
        >
          Copy private tracking link
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void share(true)}
        >
          Show private tracking QR
        </button>
      </div>
      {busy && <p role="status">Preparing private tracking access…</p>}
      {image && (
        <img
          src={image}
          alt={`Private tracking QR for ${orderNumber ?? "your order"}`}
          width="200"
          height="200"
        />
      )}
      {error && <InlineMessage>{error}</InlineMessage>}
    </details>
  );
}
