import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import isEmail from "validator/lib/isEmail";
import isURL from "validator/lib/isURL";
import { FiCoffee } from "react-icons/fi";
import {
  SHOP_LIMITS,
  SHOP_SETTINGS_LIMITS,
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
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

const fields = [
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
const valuesFrom = (shop: ShopSettings) =>
  Object.fromEntries(fields.map(({ key }) => [key, shop[key] ?? ""])) as Values;

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
      <main className="connection-page" role="status">
        Loading shop settings…
      </main>
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
    <main className="connection-page shop-context-error">
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
    </main>
  );
}

function SettingsForm({ shop }: { shop: ShopSettings }) {
  const membership = useActiveShop();
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
  const [values, setValues] = useState(() => valuesFrom(shop));
  const [baseline, setBaseline] = useState(() => valuesFrom(shop));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saving = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: UpdateShopRequest) => updateShop(shop.id, input),
    retry: false,
  });
  const dirty = fields.some(({ key }) => values[key].trim() !== baseline[key]);
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const next: Partial<Record<Field, string>> = {};
    for (const { key, max } of fields)
      if (values[key].trim().length > max)
        next[key] = `Use no more than ${max} characters.`;
    if (!values.name.trim()) next.name = "Enter your business name.";
    if (values.contactEmail.trim() && !isEmail(values.contactEmail.trim()))
      next.contactEmail = "Enter a valid contact email.";
    if (
      values.website.trim() &&
      !isURL(values.website.trim(), {
        protocols: ["http", "https"],
        require_protocol: true,
        disallow_auth: true,
      })
    )
      next.website = "Enter a full http:// or https:// website address.";
    setError("");
    showErrors(next);
    if (Object.keys(next).length) return;
    const changes = Object.fromEntries(
      fields
        .filter(({ key }) => values[key].trim() !== baseline[key])
        .map(({ key }) => [key, values[key].trim()]),
    ) as UpdateShopRequest;
    if (!Object.keys(changes).length) return;
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
    <main className="account-page shop-context-page">
      <header className="workspace-header">
        <Link className="wordmark" to={shopPath(shop.id)}>
          <FiCoffee aria-hidden="true" /> PaServe.
        </Link>
        <AppearanceToggle />
      </header>
      <section
        className="shop-context-content profile-card shop-create-card shop-settings-card"
        aria-labelledby="settings-heading"
      >
        <p className="section-label">{membership.shop.name}</p>
        <h1 id="settings-heading" ref={heading} tabIndex={-1}>
          Shop settings
        </h1>
        <p className="form-intro">
          Keep your business details up to date. Contact and operating details
          are optional.
        </p>
        <p className="field-hint">
          Menu slug: <strong>{shop.slug}</strong>. Changing your name keeps this
          address.
        </p>
        <form
          ref={form}
          className="registration-form"
          noValidate
          aria-busy={mutation.isPending}
          onSubmit={(event) => void submit(event)}
        >
          {fields.map((field) => (
            <div key={field.key}>
              {"section" in field && <h2>{field.section}</h2>}
              <div className="field">
                <label htmlFor={`settings-${field.key}`}>
                  {field.label}
                  {field.key === "name" ? " (required)" : ""}
                </label>
                {"multiline" in field ? (
                  <textarea
                    id={`settings-${field.key}`}
                    name={field.key}
                    rows={3}
                    maxLength={field.max}
                    value={values[field.key]}
                    disabled={mutation.isPending}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={`settings-${field.key}-hint${errors[field.key] ? ` settings-${field.key}-error` : ""}`}
                    onChange={(event) => {
                      setValues({ ...values, [field.key]: event.target.value });
                      setErrors({ ...errors, [field.key]: undefined });
                    }}
                  />
                ) : (
                  <input
                    id={`settings-${field.key}`}
                    name={field.key}
                    type={"type" in field ? field.type : "text"}
                    required={field.key === "name"}
                    maxLength={field.max}
                    value={values[field.key]}
                    disabled={mutation.isPending}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={`settings-${field.key}-hint${errors[field.key] ? ` settings-${field.key}-error` : ""}`}
                    onChange={(event) => {
                      setValues({ ...values, [field.key]: event.target.value });
                      setErrors({ ...errors, [field.key]: undefined });
                    }}
                  />
                )}
                <p className="field-hint" id={`settings-${field.key}-hint`}>
                  {"hint" in field
                    ? field.hint
                    : `Up to ${field.max} characters.`}
                </p>
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
          ))}
          <section aria-labelledby="branding-heading">
            <h2 id="branding-heading">Branding</h2>
            <p className="field-hint">
              Logo and banner customization are planned for a future update.
            </p>
          </section>
          {error && <InlineMessage>{error}</InlineMessage>}
          <p role="status" className="sr-only">
            {mutation.isPending ? "Saving shop settings. Please wait." : ""}
          </p>
          <div className="shop-context-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={mutation.isPending || !dirty}
            >
              {mutation.isPending ? "Saving…" : "Save settings"}
            </button>
            <Link className="shop-create-cancel" to={shopPath(shop.id)}>
              Back to shop
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
