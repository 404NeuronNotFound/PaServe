import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload, FiLoader } from "react-icons/fi";
import {
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
import { ProductPhotoPicker } from "./ProductPhotoPicker";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function ProductImageUpload({
  userId,
  shopId,
  productId,
  shopSlug,
  currentImageUrl,
  disabled,
  onUploaded,
  onPending,
}: {
  userId: string;
  shopId: string;
  productId: string;
  shopSlug?: string;
  currentImageUrl: string;
  disabled: boolean;
  onUploaded: (product: MenuProduct) => void;
  onPending: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const mounted = useRef(false),
    running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function stillHere() {
    return (
      mounted.current &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  async function upload() {
    if (!file || running.current || disabled || refreshRequired || !stillHere())
      return;
    running.current = true;
    setPending(true);
    onPending(true);
    setError("");
    setSaved(false);
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
      if (
        result.product.id !== productId ||
        result.product.shopId !== shopId ||
        result.product.isArchived
      )
        throw new Error("Invalid product response");
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
      if (shopSlug) {
        void client.invalidateQueries({ queryKey: ["public-menu", shopSlug] });
        void client.invalidateQueries({
          queryKey: ["public-product", shopSlug, productId],
        });
      }
      onUploaded(result.product);
      setFile(null);
      setSaved(true);
      feedback.toast("Product image uploaded.");
    } catch (failure) {
      if (!stillHere()) return;
      let message =
        "We couldn't confirm the image save. Close this form and refresh products before trying again.";
      // Unknown outcomes and lost access require reconciliation before another upload.
      setRefreshRequired(true);
      if (isAxiosError(failure) && failure.response) {
        if (
          [400, 413].includes(failure.response.status) ||
          failure.response.data?.code === "PRODUCT_STORAGE_UNAVAILABLE"
        )
          setRefreshRequired(false);
        if (failure.response.status === 413)
          message = "Choose an image no larger than 5 MB.";
        else if (failure.response.status === 400)
          message =
            "Choose a valid JPEG, PNG or WebP image (up to 5 MB and 16 megapixels).";
        else if ([401, 403, 404].includes(failure.response.status))
          message =
            "The product or your access changed. Close this form and refresh products.";
        else if (failure.response.data?.code === "PRODUCT_STORAGE_UNAVAILABLE")
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
    <ProductPhotoPicker
      file={file}
      currentImageUrl={currentImageUrl}
      error={error}
      disabled={disabled || pending || refreshRequired}
      pending={pending}
      progress={progress}
      hint="Upload saves the photo; other edits stay in this form."
      onChange={(selected, message) => {
        setFile(selected);
        setError(message);
        setSaved(false);
      }}
    >
      {saved && <InlineMessage tone="success">Photo saved. Product details save separately.</InlineMessage>}
      {file && (
        <button
          aria-busy={pending}
          type="button"
          className="secondary-button"
          disabled={pending || disabled || refreshRequired}
          onClick={() => void upload()}
        >
          {pending ? (
            <FiLoader className="is-spinning" aria-hidden="true" />
          ) : (
            <FiUpload aria-hidden="true" />
          )}
          {pending ? "Uploading..." : "Upload image"}
        </button>
      )}
    </ProductPhotoPicker>
  );
}
