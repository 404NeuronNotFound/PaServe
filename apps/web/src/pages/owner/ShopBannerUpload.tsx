import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload } from "react-icons/fi";
import {
  SHOP_BANNER_LIMITS,
  SHOP_BANNER_TYPES,
  type CurrentUserResponse,
  type ShopSettingsResponse,
} from "@paserve/contracts";
import { uploadShopBanner } from "../../features/shops/api/banner";
import { currentUserKey } from "../../features/auth/api/session";
import { ShopBanner } from "../../components/shops/ShopBanner";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

export function ShopBannerUpload({
  shopId,
  membershipId,
  name,
  bannerUrl,
  disabled,
  onPending,
  onDirty,
}: {
  shopId: string;
  membershipId: string;
  name: string;
  bannerUrl?: string | null;
  disabled: boolean;
  onPending: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploadedBanner, setUploadedBanner] = useState<{
    previous?: string | null;
    url?: string | null;
  } | null>(null);
  const savedUrl =
    uploadedBanner?.previous === bannerUrl ? uploadedBanner?.url : bannerUrl;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(Boolean(file));
  }, [file, onDirty]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL?.(preview);
    },
    [preview],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (file || pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [file, pending]);
  const stillHere = () =>
    mounted.current &&
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
      userId;
  function clear() {
    setFile(null);
    setPreview("");
    setError("");
    if (input.current) input.current.value = "";
  }
  async function upload() {
    if (
      !file ||
      !userId ||
      disabled ||
      running.current ||
      refreshRequired ||
      !stillHere()
    )
      return;
    running.current = true;
    setPending(true);
    onPending(true);
    setError("");
    setProgress(0);
    try {
      const result = await uploadShopBanner(shopId, file, (value) => {
        if (stillHere()) setProgress(value);
      });
      if (!stillHere()) return;
      if (result.shop.id !== shopId || !result.shop.isActive)
        throw new Error("Invalid shop response");
      // Update only the saved banner; preserve other settings and local text drafts.
      const settingsKey = ["shops", membershipId, shopId, "settings"];
      await client.cancelQueries({ queryKey: settingsKey });
      if (!stillHere()) return;
      client.setQueryData<ShopSettingsResponse>(settingsKey, (current) =>
        current
          ? { shop: { ...current.shop, bannerUrl: result.shop.bannerUrl } }
          : current,
      );
      void client.invalidateQueries({
        queryKey: ["public-menu", result.shop.slug],
      });
      setUploadedBanner({ previous: bannerUrl, url: result.shop.bannerUrl });
      clear();
      feedback.toast("Shop banner saved.");
    } catch (failure) {
      if (!stillHere()) return;
      let message =
        "We could not confirm the banner save. Refresh shop settings before trying again.";
      setRefreshRequired(true);
      if (isAxiosError(failure) && failure.response) {
        const status = failure.response.status;
        if (
          status === 400 ||
          status === 413 ||
          failure.response.data?.code === "SHOP_BANNER_STORAGE_UNAVAILABLE"
        ) {
          setRefreshRequired(false);
          message =
            status === 413
              ? "Choose a banner no larger than 5 MB."
              : status === 400
                ? "Choose a valid JPEG, PNG or WebP banner, up to 5 MB and 16 megapixels."
                : "Banner uploads are unavailable. Your current banner is kept. Please try again later.";
        } else if ([401, 403, 404].includes(status))
          message =
            "Your owner access changed. Return to your shop to check it again.";
        else if (status === 409)
          message =
            "The banner changed during upload. Refresh shop settings before trying again.";
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
      className="shop-banner-upload"
      aria-labelledby="shop-banner-heading"
      aria-busy={pending}
    >
      <h2 id="shop-banner-heading">Shop banner</h2>
      <p className="field-hint">
        Your banner appears at the top of your public menu. Upload saves it
        separately from business details.
      </p>
      <ShopBanner
        url={file ? preview : savedUrl}
        name={file ? "Selected preview" : name}
      />
      <div className="field">
        <label htmlFor="shop-banner-file">
          {savedUrl ? "Replace banner" : "Choose banner"}
        </label>
        <input
          ref={input}
          id="shop-banner-file"
          type="file"
          accept={SHOP_BANNER_TYPES.join(",")}
          disabled={disabled || pending || refreshRequired}
          aria-invalid={Boolean(error)}
          aria-describedby={`shop-banner-hint${error ? " shop-banner-error" : ""}`}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            const message = !(SHOP_BANNER_TYPES as readonly string[]).includes(
              selected.type,
            )
              ? "Choose a JPEG, PNG or WebP banner."
              : !selected.size || selected.size > SHOP_BANNER_LIMITS.maxBytes
                ? "Choose a banner between 1 byte and 5 MB."
                : "";
            setError(message);
            setFile(message ? null : selected);
            setPreview(
              !message && URL.createObjectURL
                ? URL.createObjectURL(selected)
                : "",
            );
          }}
        />
        <p id="shop-banner-hint" className="field-hint">
          JPEG, PNG or WebP, up to 5 MB and 16 megapixels. A wide image is
          recommended (1920 x 640). The menu shows a centered 3:1 crop; keep
          important details near the center.
        </p>
      </div>
      {file && (
        <p className="field-hint" role="status">
          {file.name} —{" "}
          {pending
            ? "Uploading and saving banner…"
            : "Selected banner is not saved yet."}
        </p>
      )}
      {pending && (
        <progress
          aria-label="Banner upload progress"
          value={progress}
          max={100}
        />
      )}
      {error && <InlineMessage id="shop-banner-error">{error}</InlineMessage>}
      <div className="shop-context-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!file || disabled || pending || refreshRequired}
          onClick={() => void upload()}
        >
          <FiUpload aria-hidden="true" />
          {pending ? "Saving banner…" : "Upload banner"}
        </button>
        {file && (
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || pending || refreshRequired}
            onClick={clear}
          >
            Cancel selection
          </button>
        )}
      </div>
    </section>
  );
}
