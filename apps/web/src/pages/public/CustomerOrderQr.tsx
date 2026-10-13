import { useEffect, useState } from "react";
import {
  createCustomerQrImage,
  type CustomerOrderQr as QrCredential,
} from "../../features/cart/customer-order-qr";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function CustomerOrderQr({
  credential,
}: {
  credential: QrCredential | null;
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
      <h2 id="customer-qr-title">Your order QR</h2>
      {unavailable ? (
        <InlineMessage tone="warning" role="note">
          {credential
            ? "This order QR has expired. Ask the counter staff to check your order."
            : "Your order QR is unavailable in this session. Ask the counter staff for help using the order number below."}
        </InlineMessage>
      ) : current?.error ? (
        <>
          <InlineMessage>
            Could not display the order QR. Try again or ask the counter staff
            for help.
          </InlineMessage>
          <button
            className="secondary-button"
            onClick={() => {
              setState(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry QR display
          </button>
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
            Show this code to the cashier. Keep this page open until it is
            scanned.
          </p>
        </>
      ) : (
        <p aria-live="polite">Preparing your order QR…</p>
      )}
    </section>
  );
}
