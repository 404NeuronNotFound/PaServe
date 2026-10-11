import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiDownload, FiPrinter, FiX } from "react-icons/fi";
import type { RestaurantTable } from "@paserve/contracts";
import {
  generateTableQr,
  tableQrOrigin,
  type TableQr,
} from "../../features/shops/table-qr";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./table-qr.css";

export function TableQrDialog({
  table,
  shop,
  onClose,
}: {
  table: RestaurantTable;
  shop: { id: string; name: string; slug: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [qr, setQr] = useState<TableQr | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const printBusy = useRef(false);
  useEffect(() => {
    const trigger = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected)
          trigger.focus();
      });
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (table.shopId !== shop.id || !table.isActive) return;
    generateTableQr(shop.slug, table.code, tableQrOrigin())
      .then((result) => {
        if (active) setQr(result);
      })
      .catch(() => {
        if (active)
          setError(
            "We couldn’t generate this QR code. Check the public website address and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [shop.id, shop.slug, table.shopId, table.code, table.isActive, attempt]);

  const unavailable = table.shopId !== shop.id || !table.isActive;
  function retry() {
    setQr(null);
    setError("");
    setActionError("");
    setImageReady(false);
    setAttempt((value) => value + 1);
  }
  function print() {
    if (!qr || !imageReady || printBusy.current || unavailable || error) return;
    printBusy.current = true;
    setActionError("");
    try {
      window.print();
    } catch {
      setActionError("We couldn’t open the print dialog. Please try again.");
    } finally {
      printBusy.current = false;
    }
  }
  const downloadName = `${shop.slug}-table-${table.code}.svg`;
  return createPortal(
    <dialog
      ref={dialog}
      className="table-qr-dialog phase-two"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="table-qr-heading">
        <h2 id={titleId}>QR for Table {table.number}</h2>
        <button
          className="secondary-button"
          type="button"
          onClick={onClose}
          aria-label="Close QR preview"
        >
          <FiX aria-hidden="true" />
        </button>
      </header>
      {unavailable ? (
        <InlineMessage>
          This table is unavailable for QR generation.
        </InlineMessage>
      ) : (
        <>
          {qr &&
            ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
              new URL(qr.url).hostname,
            ) && (
              <InlineMessage tone="warning">
                This address only works on this computer. Open your public
                website before printing for customers.
              </InlineMessage>
            )}
          {!qr && !error && <p role="status">Generating QR code…</p>}
          {error && (
            <>
              <InlineMessage>{error}</InlineMessage>
              <button className="secondary-button" onClick={retry}>
                Try again
              </button>
            </>
          )}
          {qr && !error && (
            <article
              className="table-qr-card"
              aria-label={`Printable card for Table ${table.number}`}
            >
              <p className="table-qr-shop">{shop.name}</p>
              <h3>Table {table.number}</h3>
              <img
                width="256"
                height="256"
                src={qr.imageUrl}
                alt={`QR code for ${shop.name}, Table ${table.number}`}
                onLoad={() => setImageReady(true)}
                onError={() => {
                  setImageReady(false);
                  setError(
                    "We couldn’t display this QR code. Please try again.",
                  );
                }}
              />
              <p className="table-qr-instruction">Scan to view our menu</p>
              <p className="table-qr-url">{qr.url}</p>
            </article>
          )}
          {qr && !error && (
            <p className="table-qr-hint">
              Print at actual size with the white border intact. The QR also
              downloads as a scalable SVG.
            </p>
          )}
          {actionError && <InlineMessage>{actionError}</InlineMessage>}
          <footer className="table-qr-actions">
            <button
              className="primary-button"
              disabled={!qr || !imageReady || !!error}
              onClick={print}
            >
              <FiPrinter aria-hidden="true" /> Print card
            </button>
            {qr && !error && (
              <a
                className="secondary-button"
                href={qr.imageUrl}
                download={downloadName}
              >
                <FiDownload aria-hidden="true" /> Download SVG
              </a>
            )}
          </footer>
        </>
      )}
    </dialog>,
    document.body,
  );
}
