import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload } from "react-icons/fi";
import {
  type CurrentUserResponse,
  type ShopSettingsResponse,
} from "@paserve/contracts";
import { uploadShopBanner } from "../../features/shops/api/banner";
import { currentUserKey } from "../../features/auth/api/session";
import { BrandPhotoPicker } from "./BrandPhotoPicker";
import { feedback } from "../../app/stores/feedback";

export function ShopBannerUpload({
  shopId,
  membershipId,
  name,
  bannerUrl,
  disabled,
  onPending,
  onDirty,
  onPreview,
}: {
  shopId: string;
  membershipId: string;
  name: string;
  bannerUrl?: string | null;
  disabled: boolean;
  onPending: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  onPreview?: (url: string | null) => void;
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
  useEffect(() => {
    onPreview?.(preview || savedUrl || null);
  }, [preview, savedUrl, onPreview]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [cropping, setCropping] = useState(false);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(Boolean(file) || cropping);
  }, [file, cropping, onDirty]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL?.(preview);
    },
    [preview],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (file || pending || cropping) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [file, pending, cropping]);
  const stillHere = () =>
    mounted.current &&
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
      userId;
  function clear() {
    setFile(null);
    setPreview("");
    setError("");
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
    <BrandPhotoPicker
      kind="banner"
      file={file}
      selectedPreviewUrl={preview}
      currentImageUrl={savedUrl || ""}
      disabled={disabled || pending || refreshRequired}
      error={error}
      pending={pending}
      progress={progress}
      hint={`JPEG, PNG or WebP, up to 5 MB and 16 megapixels. Crop to a wide, 3:1 frame; wide screens may crop the top and bottom. Your image saves separately from business details for ${name}.`}
      onCropping={(value) => {
        setCropping(value);
        onPending(value);
      }}
      onChange={(selected, message) => {
        setFile(selected);
        setError(message);
        setPreview(
          selected && URL.createObjectURL ? URL.createObjectURL(selected) : "",
        );
      }}
    >
      <div className="shop-context-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!file || disabled || pending || refreshRequired}
          onClick={() => void upload()}
        >
          <FiUpload aria-hidden="true" />
          {pending ? "Saving banner..." : "Upload banner"}
        </button>
      </div>
    </BrandPhotoPicker>
  );
}
