import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload, FiLoader } from "react-icons/fi";
import {
  PRODUCT_IMAGE_LIMITS,
  PRODUCT_IMAGE_TYPES,
  type MenuProduct,
  type CurrentUserResponse,
  type ProductsResponse,
} from "@paserve/contracts";
import {
  uploadProductImage,
  productsKey,
} from "../../features/shops/api/products";
import { currentUserKey } from "../../features/auth/api/session";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
export function ProductImageUpload({
  userId,
  shopId,
  productId,
  disabled,
  onUploaded,
  onPending,
}: {
  userId: string;
  shopId: string;
  productId: string;
  disabled: boolean;
  onUploaded: (product: MenuProduct) => void;
  onPending: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [progress, setProgress] = useState(0),
    [preview, setPreview] = useState("");
  const mounted = useRef(false),
    running = useRef(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL?.(preview);
    };
  }, [preview]);
  function stillHere() {
    return (
      mounted.current &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  function select(file?: File) {
    setError("");
    setFile(null);
    setPreview("");
    if (!file) return;
    if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (!file.size || file.size > PRODUCT_IMAGE_LIMITS.maxBytes) {
      setError("Choose an image between 1 byte and 5 MB.");
      return;
    }
    setFile(file);
    if (URL.createObjectURL) setPreview(URL.createObjectURL(file));
  }
  async function upload() {
    if (!file || running.current || disabled || !stillHere()) return;
    running.current = true;
    setPending(true);
    onPending(true);
    setError("");
    setProgress(0);
    try {
      const result = await uploadProductImage(
        shopId,
        productId,
        file,
        (percent) => {
          if (stillHere()) setProgress(percent);
        },
      );
      if (!stillHere()) return;
      const key = productsKey(userId, shopId);
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      client.setQueryData<ProductsResponse>(key, (current) =>
        current
          ? {
              products: current.products.map((item) =>
                item.id === productId ? result.product : item,
              ),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: key });
      onUploaded(result.product);
      setFile(null);
      setPreview("");
      if (input.current) input.current.value = "";
      feedback.toast("Product image uploaded.");
    } catch (error) {
      if (!stillHere()) return;
      let message =
        "We couldn’t confirm the image save. Close this form and refresh products before trying again.";
      if (isAxiosError(error) && error.response) {
        if (error.response.status === 413)
          message = "Choose an image no larger than 5 MB.";
        else if (error.response.status === 400)
          message =
            "Choose a valid JPEG, PNG or WebP image (up to 5 MB and 16 megapixels).";
        else if ([401, 403, 404].includes(error.response.status))
          message =
            "The product or your access changed. Close this form and refresh products.";
        else if (error.response.data?.code === "PRODUCT_STORAGE_UNAVAILABLE")
          message =
            "Image uploads are unavailable. Your current image is kept. Please try again later.";
      }
      setError(message);
    } finally {
      running.current = false;
      if (stillHere()) {
        setPending(false);
        onPending(false);
      }
    }
  }
  return (
    <section
      className="product-image-upload"
      aria-labelledby="product-image-upload-title"
    >
      <h3 id="product-image-upload-title">Upload a photo</h3>
      <label htmlFor="product-photo-file">Image file</label>
      <input
        ref={input}
        id="product-photo-file"
        type="file"
        accept={PRODUCT_IMAGE_TYPES.join(",")}
        disabled={disabled || pending}
        aria-describedby={`product-photo-hint${error ? " product-photo-error" : ""}`}
        aria-invalid={Boolean(error)}
        onChange={(event) => select(event.target.files?.[0])}
      />
      <p id="product-photo-hint" className="field-hint">
        JPEG, PNG or WebP · up to 5 MB. Uploads save immediately; other edits
        stay in this form.
      </p>
      {preview && (
        <img
          className="product-image-preview"
          src={preview}
          alt="Selected product photo preview"
        />
      )}
      {file && <p className="field-hint">{file.name}</p>}
      {error && <InlineMessage id="product-photo-error">{error}</InlineMessage>}
      {pending && (
        <p role="status" className="field-hint">
          {progress < 100
            ? `Uploading… ${progress}%`
            : "Processing and saving image…"}
        </p>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={!file || pending || disabled}
        onClick={() => void upload()}
      >
        {pending ? (
          <FiLoader className="is-spinning" aria-hidden="true" />
        ) : (
          <FiUpload aria-hidden="true" />
        )}
        {pending ? "Uploading…" : "Upload image"}
      </button>
    </section>
  );
}
