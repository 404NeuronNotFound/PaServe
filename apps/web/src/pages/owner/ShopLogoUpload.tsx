import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiUpload } from "react-icons/fi";
import {
  SHOP_LOGO_LIMITS,
  SHOP_LOGO_TYPES,
  type CurrentUserResponse,
  type ShopSettingsResponse,
  type UserMembership,
} from "@paserve/contracts";
import { uploadShopLogo } from "../../features/shops/api/logo";
import { activeShopKey } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { ShopLogo } from "../../components/shops/ShopLogo";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

export function ShopLogoUpload({
  shopId,
  membershipId,
  name,
  logoUrl,
  disabled,
  onPending,
  onDirty,
}: {
  shopId: string;
  membershipId: string;
  name: string;
  logoUrl?: string | null;
  disabled: boolean;
  onPending: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploadedLogo, setUploadedLogo] = useState<{
    previous?: string | null;
    url?: string | null;
  } | null>(null);
  const savedUrl =
    uploadedLogo?.previous === logoUrl ? uploadedLogo?.url : logoUrl;
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
      const result = await uploadShopLogo(shopId, file, (value) => {
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
      feedback.toast("Shop logo saved.");
    } catch (failure) {
      if (!stillHere()) return;
      let message =
        "We could not confirm the logo save. Refresh shop settings before trying again.";
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
            "The logo changed during upload. Refresh shop settings before trying again.";
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
      className="shop-logo-upload"
      aria-labelledby="shop-logo-heading"
      aria-busy={pending}
    >
      <h2 id="shop-logo-heading">Shop logo</h2>
      <p className="field-hint">
        Your logo appears on your public menu and shop pages. Upload saves it
        separately from business details.
      </p>
      <ShopLogo
        url={file ? preview : savedUrl}
        name={file ? "Selected logo preview" : name}
      />
      <div className="field">
        <label htmlFor="shop-logo-file">
          {savedUrl ? "Replace logo" : "Choose logo"}
        </label>
        <input
          ref={input}
          id="shop-logo-file"
          type="file"
          accept={SHOP_LOGO_TYPES.join(",")}
          disabled={disabled || pending || refreshRequired}
          aria-invalid={Boolean(error)}
          aria-describedby={`shop-logo-hint${error ? " shop-logo-error" : ""}`}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (!selected) return;
            const message = !(SHOP_LOGO_TYPES as readonly string[]).includes(
              selected.type,
            )
              ? "Choose a JPEG, PNG or WebP logo."
              : !selected.size || selected.size > SHOP_LOGO_LIMITS.maxBytes
                ? "Choose a logo between 1 byte and 5 MB."
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
        <p id="shop-logo-hint" className="field-hint">
          JPEG, PNG or WebP, up to 5 MB and 16 megapixels. Transparent logos are
          supported; the image is fitted without cropping.
        </p>
      </div>
      {file && (
        <p className="field-hint" role="status">
          {file.name} —{" "}
          {pending
            ? "Uploading and saving logo…"
            : "Selected logo is not saved yet."}
        </p>
      )}
      {pending && (
        <progress
          aria-label="Logo upload progress"
          value={progress}
          max={100}
        />
      )}
      {error && <InlineMessage id="shop-logo-error">{error}</InlineMessage>}
      <div className="shop-context-actions">
        <button
          type="button"
          className="primary-button"
          disabled={!file || disabled || pending || refreshRequired}
          onClick={() => void upload()}
        >
          <FiUpload aria-hidden="true" />
          {pending ? "Saving logo…" : "Upload logo"}
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
