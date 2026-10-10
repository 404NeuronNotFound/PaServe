import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiLayers,
  FiLoader,
  FiPlus,
  FiEye,
  FiEyeOff,
  FiEdit2,
  FiTrash2,
  FiShuffle,
} from "react-icons/fi";
import {
  CATEGORY_LIMITS,
  CATEGORY_REORDER_MAX,
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
  deleteCategory,
  setCategoryVisibility,
  reorderCategories,
} from "../../features/shops/api/categories";
import { feedback } from "../../app/stores/feedback";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "./categories.css";
import { CategoryEditor } from "./CategoryEditor";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { CategoryOrderEditor } from "./CategoryOrderEditor";

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
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [editing, setEditing] = useState<MenuCategory | null>(null);
  const [deleting, setDeleting] = useState<MenuCategory | null>(null);
  const [reordering, setReordering] = useState(false);
  const orderBusy = useRef(false);
  const [visibilityError, setVisibilityError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const visibilityBusy = useRef(false);
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
  const deletion = useMutation({
    mutationFn: (categoryId: string) => deleteCategory(shopId, categoryId),
    retry: false,
  });
  const visibility = useMutation({
    mutationFn: ({
      id,
      isVisible,
      expectedVisibility,
    }: {
      id: string;
      isVisible: boolean;
      expectedVisibility: boolean;
    }) => setCategoryVisibility(shopId, id, { isVisible, expectedVisibility }),
    retry: false,
    networkMode: "always",
  });
  const order = useMutation({
    mutationFn: ({
      categoryIds,
      expectedOrder,
    }: {
      categoryIds: string[];
      expectedOrder: string[];
    }) => reorderCategories(shopId, { categoryIds, expectedOrder }),
    retry: false,
    networkMode: "always",
  });
  async function saveOrder(
    categoryIds: string[],
    expectedOrder: string[],
    undo = false,
  ): Promise<boolean> {
    if (!stillHere())
      throw new Error(
        "Return to this shop’s Categories page before changing its order.",
      );
    if (orderBusy.current || visibilityBusy.current)
      throw new Error("Wait for the current menu update to finish.");
    orderBusy.current = true;
    try {
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return false;
      const result = await order.mutateAsync({ categoryIds, expectedOrder });
      if (!stillHere()) return false;
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return false;
      client.setQueryData(key, result);
      void client.invalidateQueries({ queryKey: key });
      if (!undo)
        feedback.snackbar(
          "Category order saved.",
          {
            label: "Undo",
            onClick: async () => {
              await saveOrder(
                expectedOrder,
                result.categories.map((category) => category.id),
                true,
              );
            },
            errorMessage: (failure) =>
              failure instanceof Error
                ? failure.message
                : "We couldn’t undo the order. Refresh the categories.",
          },
          { key: `category-order:${userId}:${shopId}` },
        );
      return true;
    } catch (failure) {
      if (!stillHere()) return false;
      let message = "We couldn’t save the order. Please try again.";
      if (isAxiosError(failure)) {
        if (failure.response?.status === 409)
          message =
            "The category list or order changed elsewhere. Cancel and refresh categories before arranging again.";
        else if ([401, 403, 404].includes(failure.response?.status ?? 0))
          message =
            "Categories or your access changed. Cancel and refresh categories to continue.";
        else if (!failure.response)
          message =
            "We couldn’t confirm the saved order. Cancel and refresh categories before trying again.";
      }
      throw new Error(message, { cause: failure });
    } finally {
      orderBusy.current = false;
    }
  }
  function visibilityMessage(failure: unknown) {
    if (isAxiosError(failure)) {
      if ([401, 403, 404].includes(failure.response?.status ?? 0))
        return "This category is unavailable or your access changed. Refresh the categories to continue.";
      if (failure.response?.status === 409)
        return "Visibility changed elsewhere. Refresh the categories before trying again.";
      if (!failure.response)
        return "We couldn’t confirm visibility. Refresh the categories before trying again.";
    }
    return "We couldn’t update visibility. Please try again.";
  }
  function stillHere() {
    return (
      mounted.current &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  async function changeVisibility(
    category: MenuCategory,
    isVisible: boolean,
    undo = false,
  ) {
    if (!stillHere()) {
      if (undo)
        throw new Error(
          "Return to this shop’s Categories page before using Undo.",
        );
      return;
    }
    if (visibilityBusy.current || orderBusy.current) {
      if (undo)
        throw new Error("Wait for the current visibility update to finish.");
      return;
    }
    visibilityBusy.current = true;
    setVisibilityError(null);
    try {
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      const result = await visibility.mutateAsync({
        id: category.id,
        isVisible,
        expectedVisibility: category.isVisible,
      });
      if (!stillHere()) return;
      await client.cancelQueries({ queryKey: key });
      if (!stillHere()) return;
      client.setQueryData<CategoriesResponse>(key, (current) =>
        current
          ? {
              categories: current.categories.map((item) =>
                item.id === result.category.id ? result.category : item,
              ),
            }
          : current,
      );
      void client.invalidateQueries({ queryKey: key });
      if (!undo)
        feedback.snackbar(
          isVisible
            ? `“${result.category.name}” is visible on the menu.`
            : `“${result.category.name}” is hidden. Its products are kept.`,
          {
            label: "Undo",
            onClick: () =>
              changeVisibility(result.category, category.isVisible, true),
            errorMessage: (failure) =>
              failure instanceof Error
                ? failure.message
                : "We couldn’t undo visibility. Refresh the categories.",
          },
          { key: `category-visibility:${userId}:${shopId}:${category.id}` },
        );
    } catch (failure) {
      if (!stillHere()) return;
      const message = visibilityMessage(failure);
      if (undo) throw new Error(message, { cause: failure });
      setVisibilityError({ id: category.id, message });
    } finally {
      visibilityBusy.current = false;
    }
  }
  function deletionMessage(failure: unknown) {
    if (isAxiosError(failure)) {
      if ([401, 403, 404].includes(failure.response?.status ?? 0))
        return "This category is unavailable or you no longer have permission to delete it. Close this dialog and refresh the categories.";
      if (!failure.response)
        return "We couldn’t confirm deletion. Close this dialog and refresh the categories before trying again.";
    }
    return "We couldn’t delete the category. Your products have been kept. Please try again.";
  }
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
    if (
      submitting.current ||
      creationUncertain ||
      !authorized ||
      lostAccess ||
      reordering ||
      orderBusy.current
    )
      return;
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
        else if (!failure.response || (status && status >= 500)) {
          setCreationUncertain(true);
          setError(
            "We couldn’t confirm creation. Refresh the categories before trying again.",
          );
        } else setError("We couldn’t create this category. Please try again.");
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
        <div className="categories-heading-copy">
          <p className="section-label">YOUR MENU, ONE CHAPTER AT A TIME</p>
          <h1 id="categories-title">Categories</h1>
          <p>Give {membership.shop.name}’s menu a little structure.</p>
          <p className="categories-visibility-hint">
            Hide a category to pause it on the public menu. Its products stay
            safely linked, ready to show again.
          </p>
        </div>
        {query.isSuccess && !query.isError && (
          <div
            className="categories-menu-summary"
            aria-label="Menu visibility summary"
          >
            <span className="categories-summary-icon">
              <FiLayers aria-hidden="true" />
            </span>
            <p className="section-label">AT A GLANCE</p>
            <div>
              <strong>
                {
                  query.data.categories.filter((category) => category.isVisible)
                    .length
                }
              </strong>
              <span>visible</span>
              <span className="categories-summary-divider" aria-hidden="true" />
              <strong>
                {
                  query.data.categories.filter(
                    (category) => !category.isVisible,
                  ).length
                }
              </strong>
              <span>hidden</span>
            </div>
            <p>Organized for your guests. Flexible for you.</p>
          </div>
        )}
      </header>
      <div className="categories-layout">
        <section
          className="categories-list-panel"
          aria-labelledby="category-list-title"
        >
          <div className="categories-toolbar">
            <div className="categories-panel-heading">
              <h2 id="category-list-title" tabIndex={-1}>
                Your categories
              </h2>
              {query.isSuccess && !query.isError && (
                <span>{query.data.categories.length}</span>
              )}
            </div>
            {query.isSuccess &&
              !query.isError &&
              query.data.categories.length > 1 &&
              !reordering && (
                <button
                  id="category-reorder-button"
                  type="button"
                  className="secondary-button categories-reorder"
                  disabled={
                    Boolean(editing) ||
                    Boolean(deleting) ||
                    mutation.isPending ||
                    visibility.isPending ||
                    order.isPending ||
                    query.isFetching ||
                    lostAccess ||
                    query.data.categories.length > CATEGORY_REORDER_MAX
                  }
                  onClick={() => setReordering(true)}
                >
                  <FiShuffle aria-hidden="true" />
                  Reorder categories
                </button>
              )}
          </div>
          {query.data &&
            query.data.categories.length > CATEGORY_REORDER_MAX && (
              <InlineMessage tone="info">
                Reordering supports up to {CATEGORY_REORDER_MAX} categories at
                once.
              </InlineMessage>
            )}
          {reordering && query.data ? (
            <CategoryOrderEditor
              categories={query.data.categories}
              onSave={saveOrder}
              onClose={() => {
                setReordering(false);
                queueMicrotask(() =>
                  document.getElementById("category-reorder-button")?.focus(),
                );
              }}
            />
          ) : query.isPending ? (
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
              {query.data.categories.map((category, index) => (
                <li
                  key={category.id}
                  className={category.isVisible ? "" : "category-is-hidden"}
                  aria-busy={
                    visibility.isPending &&
                    visibility.variables?.id === category.id
                  }
                >
                  <span className="category-icon">
                    <FiLayers aria-hidden="true" />
                    <span className="category-position" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <div className="category-details">
                    <div className="category-row-heading">
                      <strong>{category.name}</strong>
                      <span
                        className={`category-visibility${category.isVisible ? " is-visible" : ""}`}
                      >
                        {category.isVisible ? (
                          <FiEye aria-hidden="true" />
                        ) : (
                          <FiEyeOff aria-hidden="true" />
                        )}
                        {category.isVisible ? "Visible" : "Hidden"}
                      </span>
                    </div>
                    <small>/{category.slug}</small>
                    {category.description && (
                      <p className="category-description">
                        {category.description}
                      </p>
                    )}
                  </div>
                  <div className="category-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`${category.isVisible ? "Hide" : "Show"} ${category.name}`}
                      disabled={
                        Boolean(editing) ||
                        Boolean(deleting) ||
                        mutation.isPending ||
                        visibility.isPending ||
                        order.isPending ||
                        lostAccess ||
                        query.isFetching
                      }
                      onClick={() =>
                        void changeVisibility(category, !category.isVisible)
                      }
                    >
                      {visibility.isPending &&
                      visibility.variables?.id === category.id ? (
                        <FiLoader className="is-spinning" aria-hidden="true" />
                      ) : category.isVisible ? (
                        <FiEyeOff aria-hidden="true" />
                      ) : (
                        <FiEye aria-hidden="true" />
                      )}
                      {visibility.isPending &&
                      visibility.variables?.id === category.id
                        ? "Saving…"
                        : category.isVisible
                          ? "Hide"
                          : "Show"}
                    </button>
                    <button
                      id={`category-edit-${category.id}`}
                      type="button"
                      className="secondary-button category-edit-button"
                      disabled={
                        Boolean(editing) ||
                        Boolean(deleting) ||
                        mutation.isPending ||
                        visibility.isPending ||
                        order.isPending ||
                        lostAccess
                      }
                      aria-label={`Edit ${category.name}`}
                      onClick={() => setEditing(category)}
                    >
                      <FiEdit2 aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      id={`category-delete-${category.id}`}
                      type="button"
                      className="secondary-button category-delete-button"
                      aria-label={`Delete ${category.name}`}
                      disabled={
                        Boolean(editing) ||
                        Boolean(deleting) ||
                        mutation.isPending ||
                        visibility.isPending ||
                        order.isPending ||
                        lostAccess
                      }
                      onClick={() => setDeleting(category)}
                    >
                      <FiTrash2 aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                  {visibilityError?.id === category.id && (
                    <InlineMessage className="category-visibility-error">
                      {visibilityError.message}
                    </InlineMessage>
                  )}
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
              disabled={
                query.isFetching ||
                visibility.isPending ||
                order.isPending ||
                reordering
              }
              onClick={() => {
                setVisibilityError(null);
                void query.refetch().then((result) => {
                  if (
                    mounted.current &&
                    client.getQueryData<CurrentUserResponse>(currentUserKey)
                      ?.user.id === userId &&
                    result.isSuccess
                  ) {
                    setCreationUncertain(false);
                    setError("");
                  }
                });
              }}
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
          <span className="categories-create-emblem" aria-hidden="true">
            <FiPlus />
          </span>
          <p className="section-label">START WITH THE BASICS</p>
          <h2 id="create-category-title">Create a category</h2>
          <p>
            A home for your next favorite. Start with Coffee, Meals, Pastries or
            Desserts.
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
                disabled={
                  mutation.isPending ||
                  creationUncertain ||
                  lostAccess ||
                  requestDenied
                }
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
              {reordering
                ? "Finish arranging categories before creating a new one. Your name draft stays here."
                : "New categories are visible by default."}
            </p>
            <p className="sr-only" role="status">
              {mutation.isPending ? "Creating category. Please wait." : ""}
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={
                mutation.isPending ||
                creationUncertain ||
                lostAccess ||
                requestDenied ||
                reordering ||
                order.isPending
              }
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
      <DecisionDialog
        open={Boolean(deleting)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description="Your products move to Uncategorized. Deleting this category can’t be undone."
        confirmLabel="Delete category"
        cancelLabel="Keep category"
        destructive
        animateClose
        errorMessage={deletionMessage}
        onConfirm={async () => {
          if (!deleting) return;
          const target = deleting;
          await deletion.mutateAsync(target.id);
          if (
            !mounted.current ||
            client.getQueryData<CurrentUserResponse>(currentUserKey)?.user
              .id !== userId
          )
            return;
          client.setQueryData<CategoriesResponse>(key, (current) =>
            current
              ? {
                  categories: current.categories.filter(
                    (category) => category.id !== target.id,
                  ),
                }
              : current,
          );
          void client.invalidateQueries({ queryKey: key });
          feedback.toast(
            "Category deleted. Linked products were kept in Uncategorized.",
          );
        }}
        onClose={() => {
          const target = deleting;
          setDeleting(null);
          queueMicrotask(() =>
            (
              document.getElementById(`category-delete-${target?.id}`) ??
              document.getElementById("category-list-title")
            )?.focus(),
          );
        }}
      />
    </section>
  );
}
