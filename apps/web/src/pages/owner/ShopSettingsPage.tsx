import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import isEmail from "validator/lib/isEmail";
import isURL from "validator/lib/isURL";
import {
  SHOP_LIMITS,
  SHOP_SETTINGS_LIMITS,
  isValidShopPhone,
  SHOP_PHONE_HINT,
  DEFAULT_MENU_PRIMARY_COLOR,
  SHOP_PRIMARY_COLOR_HINT,
  isValidShopPrimaryColor,
  normalizeShopPrimaryColor,
  type ShopSettings,
  type UpdateShopRequest,
  type CurrentUserResponse,
  type ApiErrorResponse,
} from "@paserve/contracts";
import {
  useActiveShop,
  activeShopKey,
  shopPath,
} from "../../features/shops/active-shop";
import { getShopSettings, updateShop } from "../../features/shops/api/context";
import { currentUserKey } from "../../features/auth/api/session";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback, useFeedbackStore } from "../../app/stores/feedback";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { FiSave, FiRotateCcw, FiArrowLeft } from "react-icons/fi";

import { ShopLogoUpload } from "./ShopLogoUpload";
import { ShopBannerUpload } from "./ShopBannerUpload";

const fields = [
  {
    key: "primaryColor",
    label: "Primary color",
    max: 7,
    section: "Menu appearance",
    hint: SHOP_PRIMARY_COLOR_HINT,
  },
  {
    key: "name",
    label: "Business name",
    max: SHOP_LIMITS.nameMax,
    section: "Business details",
  },
  {
    key: "displayName",
    label: "Display name",
    max: SHOP_SETTINGS_LIMITS.displayName,
    hint: "Leave blank to use your business name.",
  },
  {
    key: "description",
    label: "Description",
    max: SHOP_LIMITS.descriptionMax,
    multiline: true,
  },
  {
    key: "phone",
    label: "Phone",
    max: SHOP_SETTINGS_LIMITS.phone,
    type: "tel",
    hint: SHOP_PHONE_HINT,
    section: "Contact and location",
  },
  {
    key: "contactEmail",
    label: "Contact email",
    max: SHOP_SETTINGS_LIMITS.contactEmail,
    type: "email",
  },
  {
    key: "website",
    label: "Website",
    max: SHOP_SETTINGS_LIMITS.website,
    type: "url",
    hint: "Include https:// or http://.",
  },
  {
    key: "address",
    label: "Address",
    max: SHOP_SETTINGS_LIMITS.address,
    multiline: true,
  },
  {
    key: "operatingHours",
    label: "Operating hours",
    max: SHOP_SETTINGS_LIMITS.operatingHours,
    multiline: true,
    section: "Operating information",
    hint: "For example: Monday–Friday, 8am–6pm; Saturday, 9am–4pm. Display information only; it does not schedule ordering.",
  },
] as const;
type Field = keyof UpdateShopRequest;
type Values = Record<Field, string>;
const normalizedValue = (key: Field, value: string) =>
  key === "primaryColor" ? normalizeShopPrimaryColor(value) : value.trim();
const valuesFrom = (shop: ShopSettings) =>
  Object.fromEntries(
    fields.map(({ key }) => [key, normalizedValue(key, shop[key] ?? "")]),
  ) as Values;

export function ShopSettingsPage() {
  const membership = useActiveShop();
  const settings = useQuery({
    queryKey: ["shops", membership.id, membership.shopId, "settings"],
    queryFn: ({ signal }) => getShopSettings(membership.shopId, signal),
    enabled: membership.role === "OWNER",
    retry: false,
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  if (membership.role !== "OWNER")
    return (
      <SettingsState
        title="Owner access required"
        message="Only this shop’s owner can manage its settings."
      />
    );
  if (settings.isPending)
    return (
      <section className="dashboard-status" role="status">
        Loading shop settings…
      </section>
    );
  if (settings.isError) {
    const status = isAxiosError(settings.error)
      ? settings.error.response?.status
      : undefined;
    const denied = status === 401 || status === 403 || status === 404;
    return (
      <SettingsState
        title={denied ? "Settings unavailable" : "Unable to load settings"}
        message={
          denied
            ? "Your access may have changed. Return to your shop to check it again."
            : "Check your connection and try again."
        }
        retry={denied ? undefined : () => void settings.refetch()}
      />
    );
  }
  return <SettingsForm key={membership.shopId} shop={settings.data.shop} />;
}

function SettingsState({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry?: () => void;
}) {
  const membership = useActiveShop();
  return (
    <section className="dashboard-status shop-context-error">
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      {retry && (
        <button className="primary-button" onClick={retry}>
          Try again
        </button>
      )}
      <Link className="secondary-button" to={shopPath(membership.shopId)}>
        Back to shop
      </Link>
    </section>
  );
}

function SettingsForm({ shop }: { shop: ShopSettings }) {
  const membership = useActiveShop();
  const client = useQueryClient();
  const navigate = useNavigate();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
  const [values, setValues] = useState(() => valuesFrom(shop));
  const [baseline, setBaseline] = useState(() => valuesFrom(shop));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [logoPending, setLogoPending] = useState(false);
  const [logoDirty, setLogoDirty] = useState(false);
  const [bannerPending, setBannerPending] = useState(false);
  const [bannerDirty, setBannerDirty] = useState(false);
  const [decision, setDecision] = useState<"reset" | "leave" | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saving = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: UpdateShopRequest) => updateShop(shop.id, input),
    retry: false,
  });
  const busy = mutation.isPending || logoPending || bannerPending;
  const dirty = fields.some(
    ({ key }) => normalizedValue(key, values[key]) !== baseline[key],
  );
  const resetNoticeKey = `settings-reset:${shop.id}`;
  useEffect(
    () => () => {
      const store = useFeedbackStore.getState();
      for (const notice of store.notices)
        if (notice.key === resetNoticeKey) store.dismiss(notice.id);
    },
    [resetNoticeKey],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || logoDirty || bannerDirty || logoPending || bannerPending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, logoDirty, bannerDirty, logoPending, bannerPending]);
  useEffect(() => {
    document.title = `Shop settings · ${shop.name} · PaServe`;
    heading.current?.focus();
  }, [shop.name]);

  function showErrors(next: Partial<Record<Field, string>>) {
    setErrors(next);
    const first = fields.find(({ key }) => next[key]);
    if (first)
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(`[name="${first.key}"]`)
          ?.focus(),
      );
  }
  function fieldError(key: Field, value: string): string | undefined {
    const field = fields.find((item) => item.key === key)!;
    const trimmed = value.trim();
    if (key === "primaryColor" && !isValidShopPrimaryColor(value))
      return SHOP_PRIMARY_COLOR_HINT;
    if (trimmed.length > field.max)
      return `Use no more than ${field.max} characters.`;
    if (key === "name" && !trimmed) return "Enter your business name.";
    if (key === "phone" && !isValidShopPhone(value)) return SHOP_PHONE_HINT;
    if (key === "contactEmail" && trimmed && !isEmail(trimmed))
      return "Enter a valid contact email.";
    if (
      key === "website" &&
      trimmed &&
      !isURL(trimmed, {
        protocols: ["http", "https"],
        require_protocol: true,
        disallow_auth: true,
      })
    )
      return "Enter a full http:// or https:// website address.";
  }
  function changeField(key: Field, value: string) {
    if (key === "phone" && /[^0-9+ ()-]/.test(value)) {
      setErrors((current) => ({
        ...current,
        phone: "Use digits for your phone number; letters are not allowed.",
      }));
      return;
    }
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (logoPending || bannerPending || saving.current) return;
    const next: Partial<Record<Field, string>> = {};
    for (const { key } of fields) {
      const message = fieldError(key, values[key]);
      if (message) next[key] = message;
    }
    setError("");
    showErrors(next);
    if (Object.keys(next).length) return;
    const changes = Object.fromEntries(
      fields
        .filter(
          ({ key }) => normalizedValue(key, values[key]) !== baseline[key],
        )
        .map(({ key }) => [key, normalizedValue(key, values[key])]),
    ) as UpdateShopRequest;
    if (!Object.keys(changes).length) return;
    for (const notice of useFeedbackStore.getState().notices) {
      if (notice.key === resetNoticeKey)
        useFeedbackStore.getState().dismiss(notice.id);
    }
    saving.current = true;
    try {
      const saved = await mutation.mutateAsync(changes);
      const user =
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user;
      // A response from the previous account must not repopulate private caches.
      if (!user || user.id !== userId) return;
      const updated = valuesFrom(saved.shop);
      setValues(updated);
      setBaseline(updated);
      client.setQueryData(["shops", membership.id, shop.id, "settings"], saved);
      void client.invalidateQueries({
        queryKey: ["public-menu", saved.shop.slug],
      });
      if (user) {
        client.setQueryData(activeShopKey(user.id, shop.id), {
          ...membership,
          shop: { ...membership.shop, name: saved.shop.name },
        });
        client.setQueryData<CurrentUserResponse>(currentUserKey, {
          user: {
            ...user,
            memberships: user.memberships.map((item) =>
              item.shopId === shop.id
                ? { ...item, shop: { ...item.shop, name: saved.shop.name } }
                : item,
            ),
          },
        });
      }
      feedback.toast(`Settings saved for ${saved.shop.name}.`);
    } catch (failure: unknown) {
      if (
        isAxiosError<ApiErrorResponse>(failure) &&
        failure.response?.data.code === "VALIDATION_ERROR"
      ) {
        const nextErrors = Object.fromEntries(
          fields
            .filter(({ key }) => failure.response?.data.fieldErrors?.[key]?.[0])
            .map(({ key }) => [
              key,
              failure.response!.data.fieldErrors![key][0],
            ]),
        );
        showErrors(nextErrors);
        setError("Please check the highlighted fields.");
      } else if (
        isAxiosError(failure) &&
        [401, 403, 404].includes(failure.response?.status ?? 0)
      ) {
        setError(
          "Your access may have changed. Return to your shop to check it again.",
        );
      } else
        setError(
          "We could not confirm the save. Your edits are still here; check your connection and try again.",
        );
    } finally {
      saving.current = false;
    }
  }
  return (
    <section
      className="shop-context-content profile-card shop-create-card shop-settings-card"
      aria-labelledby="settings-heading"
    >
      <p className="section-label">{membership.shop.name}</p>
      <h1 id="settings-heading" ref={heading} tabIndex={-1}>
        Shop settings
      </h1>
      <p className="form-intro">
        Keep your business details up to date. Contact and operating details are
        optional.
      </p>
      <p className="field-hint">
        Menu slug: <strong>{shop.slug}</strong>. Changing your name keeps this
        address.
      </p>
      <ShopLogoUpload
        shopId={shop.id}
        membershipId={membership.id}
        name={shop.name}
        logoUrl={shop.logoUrl}
        disabled={mutation.isPending || bannerPending}
        onPending={setLogoPending}
        onDirty={setLogoDirty}
      />
      <ShopBannerUpload
        shopId={shop.id}
        membershipId={membership.id}
        name={shop.name}
        bannerUrl={shop.bannerUrl}
        disabled={mutation.isPending || logoPending}
        onPending={setBannerPending}
        onDirty={setBannerDirty}
      />
      <form
        ref={form}
        className="registration-form settings-form-grid"
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={(event) => void submit(event)}
      >
        {fields.map((field) => (
          <Fragment key={field.key}>
            {"section" in field && (
              <h2 className="settings-group-heading">{field.section}</h2>
            )}
            <div
              className={
                field.key === "description" || field.key === "operatingHours"
                  ? "settings-field settings-field-wide"
                  : "settings-field"
              }
            >
              <div className="field">
                <label htmlFor={`settings-${field.key}`}>
                  {field.label}
                  {field.key === "name" ? " (required)" : ""}
                </label>
                {field.key === "primaryColor" && (
                  <input
                    type="color"
                    className="shop-color-picker"
                    aria-label="Choose primary color"
                    aria-describedby="settings-primaryColor-hint"
                    value={
                      isValidShopPrimaryColor(values.primaryColor) &&
                      values.primaryColor.trim()
                        ? normalizeShopPrimaryColor(values.primaryColor)
                        : DEFAULT_MENU_PRIMARY_COLOR
                    }
                    disabled={busy}
                    onChange={(event) =>
                      changeField("primaryColor", event.target.value)
                    }
                  />
                )}
                {"multiline" in field ? (
                  <textarea
                    id={`settings-${field.key}`}
                    name={field.key}
                    rows={3}
                    maxLength={field.max}
                    value={values[field.key]}
                    disabled={busy}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={`settings-${field.key}-hint${errors[field.key] ? ` settings-${field.key}-error` : ""}`}
                    onChange={(event) =>
                      changeField(field.key, event.target.value)
                    }
                    onBlur={() =>
                      setErrors((current) => ({
                        ...current,
                        [field.key]: fieldError(field.key, values[field.key]),
                      }))
                    }
                  />
                ) : (
                  <input
                    id={`settings-${field.key}`}
                    name={field.key}
                    type={"type" in field ? field.type : "text"}
                    inputMode={
                      field.key === "phone"
                        ? "tel"
                        : field.key === "contactEmail"
                          ? "email"
                          : field.key === "website"
                            ? "url"
                            : "text"
                    }
                    autoComplete={
                      field.key === "phone"
                        ? "tel"
                        : field.key === "contactEmail"
                          ? "email"
                          : field.key === "website"
                            ? "url"
                            : field.key === "name"
                              ? "organization"
                              : "off"
                    }
                    autoCapitalize={
                      field.key === "contactEmail" || field.key === "website"
                        ? "none"
                        : undefined
                    }
                    spellCheck={
                      field.key === "phone" ||
                      field.key === "contactEmail" ||
                      field.key === "website"
                        ? false
                        : undefined
                    }
                    required={field.key === "name"}
                    maxLength={field.max}
                    value={values[field.key]}
                    disabled={busy}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={`settings-${field.key}-hint${errors[field.key] ? ` settings-${field.key}-error` : ""}`}
                    onChange={(event) =>
                      changeField(field.key, event.target.value)
                    }
                    onBlur={() =>
                      setErrors((current) => ({
                        ...current,
                        [field.key]: fieldError(field.key, values[field.key]),
                      }))
                    }
                  />
                )}
                <p className="field-hint" id={`settings-${field.key}-hint`}>
                  {"hint" in field
                    ? field.hint
                    : `Up to ${field.max} characters.`}
                </p>
                {"multiline" in field && (
                  <span className="field-character-count" aria-hidden="true">
                    {values[field.key].length} / {field.max}
                  </span>
                )}
                {errors[field.key] && (
                  <InlineMessage
                    id={`settings-${field.key}-error`}
                    className="field-error"
                  >
                    {errors[field.key]}
                  </InlineMessage>
                )}
              </div>
            </div>
          </Fragment>
        ))}
        {error && (
          <InlineMessage className="settings-form-error">{error}</InlineMessage>
        )}
        <p role="status" className="sr-only">
          {mutation.isPending ? "Saving shop settings. Please wait." : ""}
        </p>
        <div className="shop-context-actions settings-savebar">
          <span className="field-hint" role="status">
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !dirty}
          >
            <FiSave aria-hidden="true" />
            {mutation.isPending ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!dirty || busy}
            onClick={() => setDecision("reset")}
          >
            <FiRotateCcw aria-hidden="true" />
            Reset changes
          </button>
          <Link
            className="secondary-button"
            to={shopPath(shop.id)}
            onClick={(event) => {
              if (busy) {
                event.preventDefault();
                return;
              }
              if (dirty || logoDirty || bannerDirty) {
                event.preventDefault();
                setDecision("leave");
              }
            }}
          >
            <FiArrowLeft aria-hidden="true" />
            Back to shop
          </Link>
        </div>
      </form>
      <DecisionDialog
        open={decision !== null}
        title="Discard unsaved changes?"
        description={
          decision === "leave"
            ? "Your edits have not been saved. Discard them and return to your shop?"
            : "Reset this form to the last saved settings? Your saved shop details will stay the same."
        }
        confirmLabel={
          decision === "leave" ? "Discard and leave" : "Reset changes"
        }
        cancelLabel="Keep editing"
        destructive
        onClose={() => setDecision(null)}
        onConfirm={() => {
          if (decision === "leave") {
            void navigate(shopPath(shop.id));
            return;
          }
          const previous = { ...values };
          setValues({ ...baseline });
          setErrors({});
          setError("");
          feedback.snackbar(
            "Unsaved edits reset.",
            {
              label: "Undo",
              onClick: () => {
                setValues(previous);
                setErrors({});
              },
            },
            { key: resetNoticeKey },
          );
        }}
      />
    </section>
  );
}
