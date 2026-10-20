import { useDraftGuard } from "../../app/router/useDraftGuard";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Input } from "../../components/ui/input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { FiArrowRight, FiCoffee, FiLoader } from "react-icons/fi";
import {
  SHOP_LIMITS,
  type ApiErrorResponse,
  type CurrentUserResponse,
} from "@paserve/contracts";
import { AppearanceToggle } from "../../components/layout/AppearanceToggle";
import { currentUserKey } from "../../features/auth/api/session";
import { createShop } from "../../features/shops/api/create";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function CreateShopPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ name?: string; description?: string }>(
    {},
  );
  const [formError, setFormError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const focusField = useRef<string | null>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: createShop, retry: false });

  const navigationGuard = useDraftGuard(Boolean(name || description), mutation.isPending);
  useEffect(() => {
    document.title = "Create your shop · PaServe";
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (!mutation.isPending && focusField.current) {
      form.current
        ?.querySelector<HTMLElement>(`[name="${focusField.current}"]`)
        ?.focus();
      focusField.current = null;
    }
  }, [errors, mutation.isPending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = "Enter your shop name.";
    else if (name.trim().length > SHOP_LIMITS.nameMax)
      nextErrors.name = `Use no more than ${SHOP_LIMITS.nameMax} characters.`;
    if (description.trim().length > SHOP_LIMITS.descriptionMax)
      nextErrors.description = `Use no more than ${SHOP_LIMITS.descriptionMax} characters.`;
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length) {
      focusField.current = Object.keys(nextErrors)[0];
      return;
    }
    const creatorId = client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id;
    if (!creatorId) {
      setFormError("Your session has expired. Sign in again to create your shop.");
      return;
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
      });
      // A response from a previous account must not update the current account
      // or redirect it after logout/account switching.
      if (client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !== creatorId) return;
      client.setQueryData<CurrentUserResponse>(currentUserKey, (current) =>
        current
          ? {
              user: {
                ...current.user,
                memberships: [...current.user.memberships, result.membership],
              },
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: currentUserKey });
      feedback.toast("Your shop was created.");
      navigationGuard.release();
      void navigate("/app/account", {
        replace: true,
        state: { createdShopName: result.shop.name },
      });
    } catch (error: unknown) {
      if (client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !== creatorId) return;
      if (
        isAxiosError<ApiErrorResponse>(error) &&
        error.response?.data.code === "VALIDATION_ERROR"
      ) {
        const details = error.response.data.fieldErrors;
        setErrors({
          name: details?.name?.[0],
          description: details?.description?.[0],
        });
        focusField.current = details?.name?.length ? "name" : "description";
        setFormError("Please check the highlighted fields.");
      } else if (isAxiosError(error) && error.response?.status === 401) {
        setFormError(
          "Your session has expired. Sign in again to create your shop.",
        );
      } else if (isAxiosError(error) && !error.response) {
        setFormError(
          "We could not confirm creation. Check your account for the shop before trying again.",
        );
      } else {
        setFormError("We could not create your shop. Please try again.");
      }
    } finally {
      submitting.current = false;
    }
  }

  return (
    <main className="account-page shop-create-page phase-two">
      <header className="workspace-header">
        <Link className="wordmark" to="/app/account">
          <span className="brand-symbol">
            <FiCoffee aria-hidden="true" />
          </span>
          PaServe<span className="wordmark-period">.</span>
        </Link>
        <div className="header-actions">
          <AppearanceToggle />
          <Link className="secondary-button" to="/app/account">
            Your account
          </Link>
        </div>
      </header>
      <div className="account-content shop-create-content">
        <aside className="shop-onboarding-intro" aria-label="Getting started">
          <p className="section-label">A NEW CHAPTER</p>
          <h2>
            Your next
            <br />
            <em>great place.</em>
          </h2>
          <p>
            From the first coffee to the last table. Give your business a home
            in PaServe.
          </p>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Make it yours</strong>
                <p>Start with your business name.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Tell your story</strong>
                <p>Add a description now or later.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Step into your space</strong>
                <p>You’ll be the owner of your new shop.</p>
              </div>
            </li>
          </ol>
          <div className="onboarding-signature" aria-hidden="true">
            <FiCoffee /> SMALL DETAILS. BETTER DAYS.
          </div>
        </aside>
        <section
          className="profile-card shop-create-card"
          aria-labelledby="create-shop-heading"
        >
          <p className="section-label">YOUR PLACE STARTS HERE</p>
          <h1 id="create-shop-heading" ref={heading} tabIndex={-1}>
            Create your shop
          </h1>
          <p className="form-intro">
            Give your café or restaurant a name. You can add a short
            description, too.
          </p>
          <form
            ref={form}
            className="registration-form"
            noValidate
            aria-busy={mutation.isPending}
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <div className="field">
              <label htmlFor="shop-name">Shop name</label>
              <Input
                id="shop-name"
                name="name"
                autoComplete="organization"
                required
                maxLength={SHOP_LIMITS.nameMax}
                value={name}
                disabled={mutation.isPending}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "shop-name-error" : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                  setFormError("");
                }}
              />
              {errors.name && (
                <InlineMessage className="field-error" id="shop-name-error">
                  {errors.name}
                </InlineMessage>
              )}
            </div>
            <div className="field">
              <label htmlFor="shop-description">
                Description <span className="field-hint">(optional)</span>
              </label>
              <Textarea
                id="shop-description"
                name="description"
                rows={4}
                maxLength={SHOP_LIMITS.descriptionMax}
                value={description}
                disabled={mutation.isPending}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={`shop-description-hint${errors.description ? " shop-description-error" : ""}`}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setErrors((current) => ({
                    ...current,
                    description: undefined,
                  }));
                  setFormError("");
                }}
              />
              <p className="field-hint" id="shop-description-hint">
                A little about your place, in up to {SHOP_LIMITS.descriptionMax}{" "}
                characters.
              </p>
              {errors.description && (
                <InlineMessage
                  className="field-error"
                  id="shop-description-error"
                >
                  {errors.description}
                </InlineMessage>
              )}
            </div>
            {formError && (
              <InlineMessage>
                {formError} <Link to="/app/account">View your account</Link>
              </InlineMessage>
            )}
            <p className="field-hint">You will be the owner of this shop.</p>
            <p className="sr-only" role="status">
              {mutation.isPending ? "Creating your shop. Please wait." : ""}
            </p>
            <Button variant="default" size="inherit"
              aria-busy={mutation.isPending}
              className="primary-button"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Creating shop…" : "Create shop"}
              {mutation.isPending ? (
                <FiLoader
                  className="button-icon is-spinning"
                  aria-hidden="true"
                />
              ) : (
                <FiArrowRight className="button-icon" aria-hidden="true" />
              )}
            </Button>
            <Link className="shop-create-cancel" to="/app/account">
              Cancel and return to your account
            </Link>
          </form>
        </section>
      </div>
    </main>
  );
}
