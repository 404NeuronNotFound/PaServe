import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { PublicMenuResponse } from "@paserve/contracts";
import {
  FiCoffee,
  FiDownload,
  FiExternalLink,
  FiMaximize,
  FiPrinter,
  FiX,
} from "react-icons/fi";
import { api } from "../../lib/api/client";
import { menuTheme } from "../../lib/menu-theme";
import { Button } from "../../components/ui/button";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import {
  generatePublicMenuQr,
  isLoopbackMenuUrl,
} from "../../features/shops/public-menu-qr";
import { tableQrOrigin, type TableQr } from "../../features/shops/table-qr";
import "./public-menu-qr.css";

export function PublicMenuQr({ shopSlug }: { shopSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>
        <FiMaximize aria-hidden="true" /> Public menu QR
      </Button>
      {open && (
        <PublicMenuQrDialog
          key={shopSlug}
          shopSlug={shopSlug}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function PublicMenuQrDialog({
  shopSlug,
  onClose,
}: {
  shopSlug: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const menu = useQuery({
    queryKey: ["public-menu-qr", shopSlug],
    queryFn: async ({ signal }) => {
      // Branding is on the first public page; do not download the whole catalog.
      const { data } = await api.get<PublicMenuResponse>(
        `/menu/${encodeURIComponent(shopSlug)}`,
        { signal },
      );
      if (
        !data.shop ||
        data.shop.slug !== shopSlug ||
        typeof data.shop.name !== "string" ||
        data.table
      )
        throw new Error("This public menu could not be verified.");
      return data.shop;
    },
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const opener = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    close.current?.focus();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="public-menu-qr-dialog phase-two"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="public-menu-qr-heading">
        <div>
          <p className="section-label">SHARE YOUR PICKUP MENU</p>
          <h2 id={titleId}>A little scan. A new order.</h2>
        </div>
        <Button
          ref={close}
          variant="outline"
          type="button"
          aria-label="Close public menu QR"
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </Button>
      </header>
      {menu.isFetching ? (
        <p role="status">Loading saved shop branding...</p>
      ) : menu.isError ? (
        <div className="public-menu-qr-recovery">
          <InlineMessage>
            The public menu is unavailable. Check that your shop is active, then
            try again.
          </InlineMessage>
          <Button variant="outline" onClick={() => void menu.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        menu.data && (
          <PublicMenuQrArtwork
            key={`${shopSlug}:${menu.data.logoUrl ?? ""}`}
            shop={menu.data}
          />
        )
      )}
    </dialog>,
    document.body,
  );
}

function PublicMenuQrArtwork({ shop }: { shop: PublicMenuResponse["shop"] }) {
  const [qr, setQr] = useState<TableQr | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [qrReady, setQrReady] = useState(false);
  const [logo, setLogo] = useState<"loading" | "ready" | "failed">(
    shop.logoUrl ? "loading" : "ready",
  );
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    generatePublicMenuQr(shop.slug, tableQrOrigin())
      .then((result) => {
        if (active) setQr(result);
      })
      .catch(() => {
        if (active)
          setError(
            "We could not create the QR. Check the public website address and try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [shop.slug, attempt]);
  const local = qr ? isLoopbackMenuUrl(qr.url) : false;
  const ready = !!qr && qrReady && logo !== "loading" && !error;
  function print() {
    if (!ready || busy.current) return;
    busy.current = true;
    setActionError("");
    try {
      window.print();
    } catch {
      setActionError("The print dialog could not open. Please try again.");
    } finally {
      busy.current = false;
    }
  }
  return (
    <>
      {local && (
        <InlineMessage tone="warning">
          Local test preview. You can print this design; its localhost link
          works only on this computer. Use a public link for customer cards.
        </InlineMessage>
      )}
      {!qr && !error && <p role="status">Preparing your menu QR...</p>}
      {error && (
        <div className="public-menu-qr-recovery">
          <InlineMessage>{error}</InlineMessage>
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              setQr(null);
              setQrReady(false);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {qr && !error && (
        <>
          <article
            className="public-menu-qr-card"
            style={menuTheme(shop.primaryColor, shop.accentColor)}
            data-compact-name={shop.name.length > 48 ? "true" : undefined}
            aria-label={`Printable pickup menu card for ${shop.name}`}
          >
            <header className="public-menu-qr-brand">
              <div className="public-menu-qr-logo">
                {shop.logoUrl && logo !== "failed" ? (
                  <img
                    src={shop.logoUrl}
                    width="64"
                    height="64"
                    alt=""
                    referrerPolicy="no-referrer"
                    onLoad={() => setLogo("ready")}
                    onError={() => setLogo("failed")}
                  />
                ) : (
                  <span aria-hidden="true">
                    {shop.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <p className="public-menu-qr-shop-name">{shop.name}</p>
              <h3>
                Good things,
                <br />
                <em>to go.</em>
              </h3>
              <span className="public-menu-qr-service">
                {local ? "LOCAL TEST COPY" : "YOUR PICKUP MENU"}
              </span>
            </header>
            <div className="public-menu-qr-body">
              <p className="public-menu-qr-scan">Scan our menu.</p>
              <div className="public-menu-qr-image">
                <img
                  src={qr.imageUrl}
                  width="280"
                  height="280"
                  alt={`Scan to open ${shop.name}'s pickup menu`}
                  onLoad={() => setQrReady(true)}
                  onError={() => {
                    setQrReady(false);
                    setError("The QR image could not load. Please try again.");
                  }}
                />
              </div>
              <p className="public-menu-qr-caption">
                Open camera. Choose. Pick up.
              </p>
              <p className="public-menu-qr-url">{qr.url}</p>
            </div>
            <footer className="public-menu-qr-colophon">
              <FiCoffee aria-hidden="true" />
              <span>NO ACCOUNT NEEDED. PAY AT THE COUNTER.</span>
              <strong>PaServe.</strong>
            </footer>
          </article>
          {logo === "failed" && (
            <InlineMessage tone="warning">
              Your logo could not load. The printed card will use your shop
              initial.
            </InlineMessage>
          )}
          <p className="public-menu-qr-hint">
            Print at actual size on A4, then cut out this 90 × 55 mm business
            card. Keep the white QR border intact and test it with a phone
            before putting it on your counter.
          </p>
          {(!qrReady || logo === "loading") && (
            <p role="status" className="public-menu-qr-hint">
              Loading images for a clear printed card...
            </p>
          )}
          <div className="public-menu-qr-actions">
            <Button disabled={!ready} onClick={print}>
              <FiPrinter aria-hidden="true" />{" "}
              {local ? "Print test card" : "Print menu card"}
            </Button>
            {!local && (
              <>
                <Button asChild variant="outline">
                  <a
                    href={qr.imageUrl}
                    download={`${shop.slug}-pickup-menu-qr.svg`}
                  >
                    <FiDownload aria-hidden="true" /> Download QR SVG
                  </a>
                </Button>
                <Button asChild variant="ghost">
                  <a href={qr.url} target="_blank" rel="noopener noreferrer">
                    <FiExternalLink aria-hidden="true" /> Test menu link
                  </a>
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {actionError && <InlineMessage>{actionError}</InlineMessage>}
    </>
  );
}
