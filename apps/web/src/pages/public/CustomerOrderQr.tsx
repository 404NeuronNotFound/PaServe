import { Button } from "../../components/ui/button";
import { useEffect, useState } from "react";
import {
  createCustomerQrImage,
  type CustomerOrderQr as QrCredential,
} from "../../features/cart/customer-order-qr";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { FiCoffee } from "react-icons/fi";

export function CustomerOrderQr({
  credential,
  compact = false,
  onUseOrderNumber,
}: {
  credential: QrCredential | null;
  compact?: boolean;
  onUseOrderNumber?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    token: string;
    image?: string;
    error?: boolean;
  } | null>(null);
  const [expiredToken, setExpiredToken] = useState<string | null>(() =>
    credential && credential.expiresAt <= Date.now()
      ? credential.qrToken
      : null,
  );
  const token = credential?.qrToken;
  const expiresAt = credential?.expiresAt;
  useEffect(() => {
    if (!token || !expiresAt) return;
    let active = true;
    const expire = () => {
      if (active && Date.now() >= expiresAt) setExpiredToken(token);
    };
    let timer: number | undefined;
    function scheduleExpiry() {
      timer = window.setTimeout(
        () => {
          if (Date.now() >= expiresAt!) expire();
          else scheduleExpiry();
        },
        Math.max(0, Math.min(expiresAt! - Date.now(), 2_147_483_647)),
      );
    }
    scheduleExpiry();
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    if (Date.now() < expiresAt)
      void createCustomerQrImage(token)
        .then((image) => {
          if (active && Date.now() < expiresAt) setState({ token, image });
        })
        .catch(() => {
          if (active) setState({ token, error: true });
        });
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [token, expiresAt, attempt]);
  const current = state?.token === credential?.qrToken ? state : null;
  const unavailable = !credential || credential.qrToken === expiredToken;
  return (
    <section className="order-receipt-qr" aria-labelledby="customer-qr-title">
      {compact && (
        <span className="order-qr-brand" aria-hidden="true">
          <FiCoffee /> PaServe <span>ORDER PASS</span>
        </span>
      )}
      <h2 id="customer-qr-title">Your order QR</h2>
      {unavailable ? (
        <>
        <InlineMessage tone="warning" role="note">
          {credential
            ? "This order QR has expired. Ask the counter staff to check your order."
            : "Your order QR is unavailable in this session. Ask the counter staff for help using your order number."}
        </InlineMessage>
        {onUseOrderNumber ? (
          <Button variant="outline" size="inherit" type="button" className="secondary-button" onClick={onUseOrderNumber}>Use order number</Button>
        ) : credential && <p>Show order number <strong>{credential.orderNumber}</strong> to the counter staff. You do not need to place another order.</p>}
        </>
      ) : current?.error ? (
        <>
          <InlineMessage>
            Could not display the order QR. Try again or ask the counter staff
            for help.
          </InlineMessage>
          <Button variant="outline" size="inherit" type="submit"
            className="secondary-button"
            onClick={() => {
              setState(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry QR display
          </Button>
        </>
      ) : current?.image ? (
        <>
          <img
            src={current.image}
            alt={`Order QR for ${credential.orderNumber}`}
            className="order-receipt-qr-image"
            width={320}
            height={320}
            onError={() => setState({ token: credential.qrToken, error: true })}
          />
          <p>
            {compact
              ? "Present this code at the counter."
              : "Show this code to the cashier. Keep this page open until it is scanned."}
          </p>
        </>
      ) : (
        <p aria-live="polite">Preparing your order QR…</p>
      )}
    </section>
  );
}
