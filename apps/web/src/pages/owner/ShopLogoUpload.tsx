import { Button } from "../../components/ui/button";
import { useDraftGuard } from "../../app/router/useDraftGuard";
import { useEffect, useRef, useState } from "react";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload, FiTrash2 } from "react-icons/fi";
import {
  type CurrentUserResponse,
  type ShopSettingsResponse,
  type UserMembership,
} from "@paserve/contracts";
import { uploadShopLogo, deleteShopLogo } from "../../features/shops/api/logo";
import { activeShopKey } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { BrandPhotoPicker } from "./BrandPhotoPicker";
import { feedback } from "../../app/stores/feedback";

export function ShopLogoUpload({
  shopId,
  membershipId,
  name,
  logoUrl,
  disabled,
  onPending,
  onDirty,
  onPreview,
}: {
  shopId: string;
  membershipId: string;
  name: string;
  logoUrl?: string | null;
  disabled: boolean;
  onPending: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  onPreview?: (url: string | null) => void;
}) {
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploadedLogo, setUploadedLogo] = useState<{
    previous?: string | null;
    url?: string | null;
  } | null>(null);
  const savedUrl =
    uploadedLogo?.previous === logoUrl ? uploadedLogo?.url : logoUrl;
  useEffect(() => {
    onPreview?.(preview || savedUrl || null);
  }, [preview, savedUrl, onPreview]);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
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
  useDraftGuard(Boolean(file) || cropping, pending);
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
  async function save(removing = false) {
    if (
      (!removing && !file) ||
      !userId ||
      disabled ||
      running.current ||
      refreshRequired ||
      !stillHere()
    )
      return;
    running.current = true;
    setPending(true);
    setSavedMessage("");
    onPending(true);
    setError("");
    setProgress(0);
    try {
      const result = removing
        ? await deleteShopLogo(shopId)
        : await uploadShopLogo(shopId, file!, (value) => {
            if (stillHere()) setProgress(value);
          });
      if (!stillHere()) return;
      if (result.shop.id !== shopId || !result.shop.isActive)
        throw new Error("Invalid shop response");
      // Keep settings text drafts local while updating their saved logo and other shop identities.
      const settingsKey = ["shops", membershipId, shopId, "settings"];
      await client.cancelQueries({ queryKey: settingsKey });
      await client.cancelQueries({ queryKey: activeShopKey(userId, shopId) });
      await client.cancelQueries({ queryKey: currentUserKey });
      if (!stillHere()) return;
      client.setQueryData<ShopSettingsResponse>(settingsKey, (current) =>
        current
          ? { shop: { ...current.shop, logoUrl: result.shop.logoUrl } }
          : current,
      );
      client.setQueryData<UserMembership>(
        activeShopKey(userId, shopId),
        (current) =>
          current
            ? {
                ...current,
                shop: { ...current.shop, logoUrl: result.shop.logoUrl },
              }
            : current,
      );
      client.setQueryData<CurrentUserResponse>(currentUserKey, (current) =>
        current
          ? {
              user: {
                ...current.user,
                memberships: current.user.memberships.map((item) =>
                  item.shopId === shopId
                    ? {
                        ...item,
                        shop: { ...item.shop, logoUrl: result.shop.logoUrl },
                      }
                    : item,
                ),
              },
            }
          : current,
      );
      void client.invalidateQueries({
        queryKey: ["public-menu", result.shop.slug],
      });
      setUploadedLogo({ previous: logoUrl, url: result.shop.logoUrl });
      clear();
      setSavedMessage(removing ? "Logo removed. Business details save separately." : "Logo saved. Business details save separately.");
      feedback.toast(removing ? "Shop logo removed." : "Shop logo saved.");
    } catch (failure) {
      if (!stillHere()) return;
      let message =
        "We could not confirm the logo change. Refresh shop settings before trying again.";
      setRefreshRequired(true);
      if (isAxiosError(failure) && failure.response) {
        const status = failure.response.status;
        if (
          status === 400 ||
          status === 413 ||
          failure.response.data?.code === "SHOP_LOGO_STORAGE_UNAVAILABLE"
        ) {
          setRefreshRequired(false);
          message =
            status === 413
              ? "Choose a logo no larger than 5 MB."
              : status === 400
                ? "Choose a valid JPEG, PNG or WebP logo, up to 5 MB and 16 megapixels."
                : "Logo uploads are unavailable. Your current logo is kept. Please try again later.";
        } else if ([401, 403, 404].includes(status))
          message =
            "Your owner access changed. Return to your shop to check it again.";
        else if (status === 409)
          message =
            "The logo changed. Refresh shop settings before trying again.";
      }
      setError(message);
      if (removing) throw new Error(message, { cause: failure });
    } finally {
      running.current = false;
      if (stillHere()) {
        setPending(false);
        onPending(false);
      }
    }
  }
  return (
    <>
      <BrandPhotoPicker
        kind="logo"
        file={file}
        selectedPreviewUrl={preview}
        currentImageUrl={savedUrl || ""}
        disabled={disabled || pending || refreshRequired}
        error={error}
        pending={pending}
        progress={progress}
        hint={`Crop to a square, 1:1 frame. Your image saves separately from business details for ${name}.`}
        onCropping={(value) => {
          if (value) setSavedMessage("");
          setCropping(value);
          onPending(value);
        }}
        onChange={(selected, message) => {
          setSavedMessage("");
          setFile(selected);
          setError(message);
          setPreview(
            selected && URL.createObjectURL
              ? URL.createObjectURL(selected)
              : "",
          );
        }}
      >
        {savedMessage && <InlineMessage tone="success">{savedMessage}</InlineMessage>}
        <div className="shop-context-actions">
          <Button variant="default" size="inherit"
            aria-busy={pending}
            type="button"
            className="primary-button"
            disabled={!file || disabled || pending || refreshRequired}
            onClick={() => void save()}
          >
            <FiUpload aria-hidden="true" />
            {pending ? "Saving logo..." : "Upload logo"}
          </Button>
          {savedUrl && (
            <Button variant="outline" size="inherit"
              type="button"
              className="secondary-button"
              disabled={
                disabled ||
                pending ||
                refreshRequired ||
                Boolean(file) ||
                cropping
              }
              onClick={() => setConfirmDelete(true)}
            >
              <FiTrash2 aria-hidden="true" /> Remove logo
            </Button>
          )}
        </div>
      </BrandPhotoPicker>
      <DecisionDialog
        open={confirmDelete}
        title="Remove shop logo?"
        description="Your shop will use its default icon. You can upload another logo later."
        confirmLabel="Remove logo"
        cancelLabel="Keep logo"
        destructive
        onConfirm={() => {
          if (refreshRequired) throw new Error(error);
          return save(true);
        }}
        errorMessage={(failure) =>
          failure instanceof Error
            ? failure.message
            : "The logo could not be removed."
        }
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
