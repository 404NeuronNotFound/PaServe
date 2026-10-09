import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiLayers, FiLoader, FiPlus } from "react-icons/fi";
import {
  CATEGORY_LIMITS,
  hasShopPermission,
  type ApiErrorResponse,
  type CategoriesResponse,
  type CurrentUserResponse,
  type MenuCategory,
} from "@paserve/contracts";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  categoriesKey,
  createCategory,
  listCategories,
} from "../../features/shops/api/categories";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./categories.css";
import { CategoryEditor } from "./CategoryEditor";

export function CategoriesPage() {
  const membership = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <CategoryWorkspace key={`${userId}:${membership.shopId}`} userId={userId} />
  );
}

function CategoryWorkspace({ userId }: { userId: string }) {
  const membership = useActiveShop();
  const { shopId } = membership;
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [lostAccess, setLostAccess] = useState(false);
  const [editing, setEditing] = useState<MenuCategory | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const authorized = hasShopPermission(membership.role, "shop.menu.manage");
  const key = categoriesKey(userId, shopId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listCategories(shopId, signal),
    enabled: authorized && !lostAccess,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (categoryName: string) =>
      createCategory(shopId, { name: categoryName }),
    retry: false,
  });
  useEffect(() => {
    mounted.current = true;
    document.title = `Categories · ${membership.shop.name} · PaServe`;
    return () => {
      mounted.current = false;
    };
  }, [membership.shop.name]);
  function validate(value: string) {
    if (!value.trim()) return "Enter a category name.";
    if (value.trim().length > CATEGORY_LIMITS.nameMax)
      return `Use no more than ${CATEGORY_LIMITS.nameMax} characters.`;
    if (/\p{Cc}/u.test(value))
      return "Use a category name without control characters.";
    return "";
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !authorized || lostAccess) return;
    const invalid = validate(name);
    setFieldError(invalid);
    setError("");
    if (invalid) {
      input.current?.focus();
      return;
    }
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync(
        name.trim().replace(/\s+/g, " "),
      );
      if (
        !mounted.current ||
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !==
          userId
      )
        return;
      client.setQueryData<CategoriesResponse>(key, (current) => ({
        categories: [
          ...(current?.categories ?? []).filter(
            (category) => category.id !== result.category.id,
          ),
          result.category,
        ].sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
      }));
      void client.invalidateQueries({ queryKey: key });
      setName("");
      feedback.toast(`“${result.category.name}” was created.`);
    } catch (failure) {
      if (
        !mounted.current ||
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !==
          userId
      )
        return;
      if (isAxiosError<ApiErrorResponse>(failure)) {
        const status = failure.response?.status;
        if (status === 403 || status === 404) {
          setLostAccess(true);
          setError(
            "You no longer have access to manage categories in this shop.",
          );
        } else if (status === 401)
          setError("Your session has expired. Sign in again to continue.");
        else if (failure.response?.data.fieldErrors?.name)
          setFieldError(failure.response.data.fieldErrors.name[0]);
        else if (!failure.response)
          setError(
            "We couldn’t confirm creation. Refresh the categories before trying again.",
          );
        else setError("We couldn’t create this category. Please try again.");
      } else setError("We couldn’t create this category. Please try again.");
    } finally {
      submitting.current = false;
    }
  }
  useEffect(() => {
    if (!mutation.isPending && fieldError) input.current?.focus();
  }, [fieldError, mutation.isPending]);
  if (!authorized)
    return (
      <section className="dashboard-status">
        <h1>Categories</h1>
        <InlineMessage>
          You don’t have permission to manage categories in this shop.
        </InlineMessage>
      </section>
    );
  const requestDenied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  return (
    <section className="categories-page" aria-labelledby="categories-title">
      <header className="categories-heading">
        <p className="section-label">YOUR MENU, ONE CHAPTER AT A TIME</p>
        <h1 id="categories-title">Categories</h1>
        <p>Give {membership.shop.name}’s menu a little structure.</p>
      </header>
      <div className="categories-layout">
        <section
          className="categories-list-panel"
          aria-labelledby="category-list-title"
        >
          <div className="categories-panel-heading">
            <h2 id="category-list-title">Your categories</h2>
            {query.isSuccess && !query.isError && (
              <span>{query.data.categories.length}</span>
            )}
          </div>
          {query.isPending ? (
            <InlineMessage tone="info">Loading categories…</InlineMessage>
          ) : query.isError ? (
            <>
              <InlineMessage>
                {requestDenied
                  ? "Your category access is unavailable. Choose another shop or sign in again."
                  : "We couldn’t load your categories. Please check your connection."}
              </InlineMessage>
            </>
          ) : query.data.categories.length ? (
            <ul className="categories-list">
              {query.data.categories.map((category) => (
                <li key={category.id}>
                  <span className="category-icon">
                    <FiLayers aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{category.name}</strong>
                    <small>/{category.slug}</small>
                    {category.description && (
                      <p className="category-description">
                        {category.description}
                      </p>
                    )}
                  </div>
                  <span className="category-visibility">
                    {category.isVisible ? "Visible" : "Hidden"}
                  </span>
                  <button
                    id={`category-edit-${category.id}`}
                    type="button"
                    className="secondary-button category-edit-button"
                    disabled={
                      Boolean(editing) || mutation.isPending || lostAccess
                    }
                    aria-label={`Edit ${category.name}`}
                    onClick={() => setEditing(category)}
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="categories-empty">
              <FiLayers aria-hidden="true" />
              <h3>A place for every favorite.</h3>
              <p>Create your first category to start organizing your menu.</p>
            </div>
          )}
          {!requestDenied && !query.isPending && (
            <button
              type="button"
              className="secondary-button categories-refresh"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? "Refreshing…" : "Refresh categories"}
            </button>
          )}
          {editing && (
            <CategoryEditor
              key={editing.id}
              category={editing}
              userId={userId}
              shopId={shopId}
              onClose={() => {
                setEditing(null);
                queueMicrotask(() =>
                  document
                    .getElementById(`category-edit-${editing.id}`)
                    ?.focus(),
                );
              }}
            />
          )}
        </section>
        <section
          className="categories-create-panel"
          aria-labelledby="create-category-title"
        >
          <p className="section-label">START WITH THE BASICS</p>
          <h2 id="create-category-title">Create a category</h2>
          <p>
            Think Coffee, Meals, Pastries or Desserts. Choose a name that feels
            right for your menu.
          </p>
          <form
            noValidate
            aria-busy={mutation.isPending}
            onSubmit={(event) => void submit(event)}
          >
            <div className="field">
              <label htmlFor="category-name">Category name</label>
              <input
                ref={input}
                id="category-name"
                name="name"
                required
                autoComplete="off"
                maxLength={CATEGORY_LIMITS.nameMax}
                value={name}
                placeholder="e.g. Coffee"
                disabled={mutation.isPending || lostAccess || requestDenied}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={`category-name-hint${fieldError ? " category-name-error" : ""}`}
                onBlur={() => {
                  if (name) setFieldError(validate(name));
                }}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldError("");
                  setError("");
                }}
              />
              <p id="category-name-hint" className="field-hint">
                A clear name, up to {CATEGORY_LIMITS.nameMax} characters.
              </p>
              {fieldError && (
                <InlineMessage id="category-name-error" className="field-error">
                  {fieldError}
                </InlineMessage>
              )}
            </div>
            {error && <InlineMessage>{error}</InlineMessage>}
            <p className="categories-form-note">
              New categories are visible by default.
            </p>
            <p className="sr-only" role="status">
              {mutation.isPending ? "Creating category. Please wait." : ""}
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={mutation.isPending || lostAccess || requestDenied}
            >
              {mutation.isPending ? (
                <FiLoader className="is-spinning" aria-hidden="true" />
              ) : (
                <FiPlus aria-hidden="true" />
              )}
              {mutation.isPending ? "Creating category…" : "Create category"}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
