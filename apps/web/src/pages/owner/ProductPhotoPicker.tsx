import { useEffect, useRef, useState, type ReactNode } from "react";
import { FiImage, FiUploadCloud, FiRefreshCw, FiX } from "react-icons/fi";
import { PRODUCT_IMAGE_LIMITS, PRODUCT_IMAGE_TYPES } from "@paserve/contracts";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function ProductPhotoPicker({
  file,
  disabled,
  error,
  onChange,
  currentImageUrl = "",
  pending = false,
  progress = 0,
  hint = "Your photo uploads when you create the product.",
  children,
  kind = "product",
  selectedPreviewUrl,
}: {
  file: File | null;
  disabled: boolean;
  error: string;
  onChange: (file: File | null, error: string) => void;
  currentImageUrl?: string;
  pending?: boolean;
  progress?: number;
  hint?: string;
  children?: ReactNode;
  kind?: "product" | "logo" | "banner";
  selectedPreviewUrl?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const [dragging, setDragging] = useState(false);
  const [failedImage, setFailedImage] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL?.(preview);
    },
    [preview, file],
  );
  const title =
    kind === "product" ? "Photo" : kind === "logo" ? "Logo" : "Banner";
  const id = `${kind}-photo`;
  const source = file ? (selectedPreviewUrl ?? preview) : currentImageUrl;
  function select(selected?: File) {
    if (!selected || disabled || pending) return;
    const message = !(PRODUCT_IMAGE_TYPES as readonly string[]).includes(
      selected.type,
    )
      ? "Choose a JPEG, PNG or WebP image."
      : !selected.size || selected.size > PRODUCT_IMAGE_LIMITS.maxBytes
        ? "Choose an image between 1 byte and 5 MB."
        : "";
    setFailedImage("");
    setPreview(
      !message && URL.createObjectURL ? URL.createObjectURL(selected) : "",
    );
    onChange(message ? null : selected, message);
  }
  return (
    <section
      className={`product-photo-panel ${kind}-photo-panel`}
      aria-label={kind === "product" ? "Product photo" : `Shop ${kind}`}
      aria-busy={pending}
    >
      <div className="product-photo-heading">
        <label id={`${id}-title`} htmlFor={`${id}-file`}>
          {title} <span className="field-hint">(optional)</span>
        </label>
        {(file || currentImageUrl) && (
          <span className="product-photo-state">
            {file ? "Ready to upload" : "Current photo"}
          </span>
        )}
      </div>
      <input
        ref={input}
        id={`${id}-file`}
        className="product-photo-input"
        type="file"
        accept={PRODUCT_IMAGE_TYPES.join(",")}
        disabled={disabled || pending}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          select(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button
        className={`product-photo-dropzone${dragging ? " is-dragging" : ""}${source ? " has-photo" : ""}`}
        type="button"
        disabled={disabled || pending}
        aria-label={`${file || currentImageUrl ? "Replace" : "Choose"} ${kind === "product" ? "photo" : kind}`}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !pending) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length !== 1) {
            if (!disabled && !pending)
              onChange(null, "Choose one photo at a time.");
            return;
          }
          select(event.dataTransfer.files[0]);
        }}
      >
        <span className="product-photo-art">
          {source && source !== failedImage ? (
            <img
              src={source}
              alt={
                file
                  ? `Selected ${kind} photo preview`
                  : `Current ${kind} photo`
              }
              onError={() => setFailedImage(source)}
            />
          ) : (
            <FiImage aria-hidden="true" />
          )}
        </span>
        <span className="product-photo-prompt">
          <span className="product-photo-eyebrow">
            {file
              ? "YOUR NEXT MENU PHOTO"
              : currentImageUrl
                ? "ON YOUR MENU"
                : kind === "product"
                  ? "MAKE IT LOOK DELICIOUS"
                  : "YOUR SHOP, YOUR STYLE"}
          </span>
          <strong>
            {file
              ? file.name
              : currentImageUrl
                ? "A fresh look, anytime."
                : kind === "product"
                  ? "Add a little appetite."
                  : `Make your ${kind} stand out.`}
          </strong>
          <span>
            {file || currentImageUrl
              ? "Click or drop a photo to replace it."
              : "Click to browse, or drop a photo here."}
          </span>
          <span className="product-photo-browse">
            <FiUploadCloud aria-hidden="true" />
            {file || currentImageUrl
              ? `Replace ${kind === "product" ? "photo" : kind}`
              : `Choose ${kind === "product" ? "photo" : kind}`}
          </span>
        </span>
      </button>
      <p id={`${id}-hint`} className="field-hint">
        JPEG, PNG or WebP, up to 5 MB. {hint}
      </p>
      {file && (
        <div className="product-photo-selection">
          <span>
            <FiImage aria-hidden="true" />
            {file.name}
            <small>
              {file.size < 1024 * 1024
                ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
            </small>
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={disabled || pending}
            onClick={() => {
              if (input.current) input.current.value = "";
              setPreview("");
              onChange(null, "");
            }}
          >
            <FiX aria-hidden="true" />
            {kind === "product" ? "Remove photo" : "Cancel selection"}
          </button>
        </div>
      )}
      {!file && error && (
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || pending}
          onClick={() => {
            if (input.current) input.current.value = "";
            setPreview("");
            onChange(null, "");
          }}
        >
          <FiRefreshCw aria-hidden="true" />
          Clear selection
        </button>
      )}
      {error && <InlineMessage id={`${id}-error`}>{error}</InlineMessage>}
      {pending && (
        <div className="product-photo-progress">
          <progress
            aria-label={
              kind === "product"
                ? "Photo upload progress"
                : `${title} upload progress`
            }
            value={progress}
            max={100}
          />
          <p className="field-hint" role="status">
            {progress < 100
              ? `Uploading... ${progress}%`
              : "Processing and saving image..."}
          </p>
        </div>
      )}
      {children}
    </section>
  );
}
