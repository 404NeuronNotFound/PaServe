import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useEffect, useRef, useState } from "react";
import { SHOP_LOGO_LIMITS, SHOP_BANNER_LIMITS } from "@paserve/contracts";
import { cropRectangle } from "../../lib/image-crop";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function BrandImageCropper({
  file,
  kind,
  onApply,
  onClose,
}: {
  file: File;
  kind: "logo" | "banner";
  onApply: (file: File) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const mounted = useRef(false);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    horizontal: number;
    vertical: number;
  } | null>(null);
  const ratio = kind === "logo" ? 1 : 3;
  const limits = kind === "logo" ? SHOP_LOGO_LIMITS : SHOP_BANNER_LIMITS;
  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    const url = URL.createObjectURL(file);
    const source = new Image();
    source.onload = () => {
      if (!mounted.current) return;
      if (
        !source.naturalWidth ||
        !source.naturalHeight ||
        source.naturalWidth > limits.maxDimension ||
        source.naturalHeight > limits.maxDimension ||
        source.naturalWidth * source.naturalHeight > limits.maxPixels
      ) {
        setError(
          "Choose an image up to 16 megapixels and 8192 pixels per side.",
        );
        return;
      }
      image.current = source;
      setReady(true);
    };
    source.onerror = () => {
      if (mounted.current)
        setError(
          "This image could not be opened. Choose a valid JPEG, PNG or WebP photo.",
        );
    };
    source.src = url;
    return () => {
      mounted.current = false;
      source.onload = null;
      source.onerror = null;
      URL.revokeObjectURL(url);
      node?.close();
      previous?.focus();
    };
  }, [file, limits]);
  useEffect(() => {
    if (!ready || !image.current || !canvas.current) return;
    const context = canvas.current.getContext("2d");
    if (!context) {
      setError("Image cropping is unavailable in this browser.");
      return;
    }
    const area = cropRectangle(
      image.current.naturalWidth,
      image.current.naturalHeight,
      ratio,
      zoom,
      x,
      y,
    );
    context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    context.drawImage(
      image.current,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      canvas.current.width,
      canvas.current.height,
    );
  }, [ready, ratio, zoom, x, y]);
  function apply() {
    if (!ready || !canvas.current || saving.current || error) return;
    saving.current = true;
    setPending(true);
    try {
      canvas.current.toBlob((blob) => {
        if (!mounted.current) return;
        saving.current = false;
        setPending(false);
        if (!blob || blob.size > limits.maxBytes) {
          setError(
            "This crop could not be prepared within 5 MB. Choose a different image.",
          );
          return;
        }
        onApply(new File([blob], `${kind}-cropped.png`, { type: "image/png" }));
      }, "image/png");
    } catch {
      saving.current = false;
      setPending(false);
      setError("This crop could not be prepared. Choose a different image.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="brand-crop-dialog"
      aria-labelledby="brand-crop-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header>
        <p className="section-label">FRAME YOUR BRAND</p>
        <h2 id="brand-crop-title">Crop {kind}</h2>
        <p>
          {kind === "logo"
            ? "A square frame for a recognizable logo. 1:1 ratio."
            : "A wide frame for your menu’s first impression. 3:1 ratio."}
        </p>
      </header>
      <div className={`brand-crop-stage ${kind}`}>
        <canvas
          ref={canvas}
          width={
            kind === "logo"
              ? SHOP_LOGO_LIMITS.outputDimension
              : SHOP_BANNER_LIMITS.outputWidth
          }
          height={
            kind === "logo"
              ? SHOP_LOGO_LIMITS.outputDimension
              : SHOP_BANNER_LIMITS.outputHeight
          }
          aria-label={`${kind} crop preview`}
          onPointerDown={(event) => {
            if (!ready || pending) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              horizontal: x,
              vertical: y,
            };
          }}
          onPointerMove={(event) => {
            if (!drag.current || !image.current || pending) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const area = cropRectangle(
              image.current.naturalWidth,
              image.current.naturalHeight,
              ratio,
              zoom,
              drag.current.horizontal,
              drag.current.vertical,
            );
            if (bounds.width && image.current.naturalWidth > area.width)
              setX(
                Math.max(
                  0,
                  Math.min(
                    100,
                    drag.current.horizontal -
                      (((event.clientX - drag.current.x) * area.width) /
                        bounds.width /
                        (image.current.naturalWidth - area.width)) *
                        100,
                  ),
                ),
              );
            if (bounds.height && image.current.naturalHeight > area.height)
              setY(
                Math.max(
                  0,
                  Math.min(
                    100,
                    drag.current.vertical -
                      (((event.clientY - drag.current.y) * area.height) /
                        bounds.height /
                        (image.current.naturalHeight - area.height)) *
                        100,
                  ),
                ),
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
        {!ready && !error && <p role="status">Opening image…</p>}
      </div>
      <div className="brand-crop-controls">
        <p className="field-hint">
          Drag the image to position it, or use the sliders below.
        </p>
        <label>
          Zoom
          <Input
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={zoom}
            disabled={!ready || pending}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label>
          Horizontal position
          <Input
            type="range"
            min="0"
            max="100"
            value={x}
            disabled={!ready || pending}
            onChange={(event) => setX(Number(event.target.value))}
          />
        </label>
        <label>
          Vertical position
          <Input
            type="range"
            min="0"
            max="100"
            value={y}
            disabled={!ready || pending}
            onChange={(event) => setY(Number(event.target.value))}
          />
        </label>
      </div>
      {error && <InlineMessage>{error}</InlineMessage>}
      <footer>
        <Button variant="outline" size="inherit"
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={onClose}
        >
          Cancel crop
        </Button>
        <Button variant="default" size="inherit"
          type="button"
          className="primary-button"
          disabled={!ready || pending || Boolean(error)}
          onClick={apply}
        >
          {pending ? "Preparing…" : "Use crop"}
        </Button>
      </footer>
    </dialog>
  );
}
