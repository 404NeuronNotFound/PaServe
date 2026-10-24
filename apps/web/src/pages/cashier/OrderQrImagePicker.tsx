import { useRef, useState } from "react";
import { FiGrid, FiUploadCloud, FiLoader } from "react-icons/fi";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "../../components/media/photo-picker.css";

export function OrderQrImagePicker({
  disabled,
  pending,
  onSelect,
}: {
  disabled: boolean;
  pending: boolean;
  onSelect: (file: File) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  function select(file?: File) {
    if (!file || disabled || pending) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      !file.size ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG, or WebP image up to 10 MB.");
      setFilename("");
      return;
    }
    setError("");
    setFilename(file.name);
    void onSelect(file);
  }
  return (
    <section
      className="product-photo-panel scanner-image-picker"
      aria-label="Order QR image"
      aria-busy={pending}
    >
      <div className="product-photo-heading">
        <label htmlFor="scanner-image">Choose an order QR image</label>
      </div>
      <Input
        ref={inputRef}
        id="scanner-image"
        className="product-photo-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled || pending}
        aria-invalid={Boolean(error)}
        aria-describedby={`scanner-image-hint${error ? " scanner-image-error" : ""}`}
        onChange={(event) => {
          select(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        variant="ghost"
        size="inherit"
        type="button"
        className={`product-photo-dropzone${dragging ? " is-dragging" : ""}`}
        disabled={disabled || pending}
        aria-label="Choose QR image"
        aria-describedby={`scanner-image-hint${error ? " scanner-image-error" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !pending) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (disabled || pending) return;
          if (event.dataTransfer.files.length !== 1) {
            setError("Choose one QR image at a time.");
          setFilename("");
            return;
          }
          select(event.dataTransfer.files[0]);
        }}
      >
        <span className="product-photo-art">
          {pending && filename ? (
            <FiLoader className="is-spinning" aria-hidden="true" />
          ) : (
            <FiGrid aria-hidden="true" />
          )}
        </span>
        <span className="product-photo-prompt">
          <span className="product-photo-eyebrow">ANOTHER WAY TO SCAN</span>
          <strong>
            {pending && filename ? "Checking your QR…" : "Have a QR photo?"}
          </strong>
          <span>Click to browse, or drop an order QR image here.</span>
          <span className="product-photo-browse">
            <FiUploadCloud aria-hidden="true" />
            {filename ? "Choose another image" : "Choose image"}
          </span>
        </span>
      </Button>
      <p id="scanner-image-hint" className="field-hint">
        PNG, JPEG or WebP · up to 10 MB. Read on this device.
      </p>
      {filename && (
        <p className="scanner-image-filename" role="status">
          {pending ? "Reading" : "Selected"}: {filename}
        </p>
      )}
      {error && <InlineMessage id="scanner-image-error">{error}</InlineMessage>}
    </section>
  );
}
