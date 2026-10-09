import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  CATEGORY_LIMITS,
  type MenuCategory,
  type CategoriesResponse,
  type CurrentUserResponse,
  type ApiErrorResponse,
} from "@paserve/contracts";
import {
  categoriesKey,
  updateCategory,
} from "../../features/shops/api/categories";
import { currentUserKey } from "../../features/auth/api/session";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { feedback } from "../../app/stores/feedback";

export function CategoryEditor({
  category,
  userId,
  shopId,
  onClose,
}: {
  category: MenuCategory;
  userId: string;
  shopId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false),
    running = useRef(false);
  const dirty =
    name.trim().replace(/\s+/g, " ") !== category.name ||
    description.trim() !== (category.description ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      updateCategory(shopId, category.id, {
        name: name.trim().replace(/\s+/g, " "),
        description: description.trim(),
      }),
    retry: false,
  });
  useEffect(() => {
    active.current = true;
    input.current?.focus();
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (nameError && !mutation.isPending) input.current?.focus();
  }, [nameError, mutation.isPending]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || unavailable || !dirty) return;
    const invalidName = !name.trim()
      ? "Enter a category name."
      : name.trim().length > CATEGORY_LIMITS.nameMax
        ? `Use no more than ${CATEGORY_LIMITS.nameMax} characters.`
        : /\p{Cc}/u.test(name)
          ? "Use a category name without control characters."
          : "";
    const invalidDescription =
      description.trim().length > CATEGORY_LIMITS.descriptionMax
        ? `Use no more than ${CATEGORY_LIMITS.descriptionMax} characters.`
        : "";
    setNameError(invalidName);
    setDescriptionError(invalidDescription);
    setError("");
    if (invalidName || invalidDescription) return;
    running.current = true;
    try {
      const result = await mutation.mutateAsync();
      if (
        !active.current ||
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !==
          userId
      )
        return;
      client.setQueryData<CategoriesResponse>(
        categoriesKey(userId, shopId),
        (current) =>
          current
            ? {
                categories: current.categories.map((item) =>
                  item.id === result.category.id ? result.category : item,
                ),
              }
            : current,
      );
      void client.invalidateQueries({
        queryKey: categoriesKey(userId, shopId),
      });
      feedback.toast("Category details saved.");
      onClose();
    } catch (failure) {
      if (
        !active.current ||
        client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !==
          userId
      )
        return;
      if (isAxiosError<ApiErrorResponse>(failure)) {
        const status = failure.response?.status;
        if ([401, 403, 404].includes(status ?? 0)) {
          setUnavailable(true);
          setError(
            "This category is unavailable or you no longer have permission to edit it.",
          );
        } else if (failure.response?.data.fieldErrors) {
          setNameError(failure.response.data.fieldErrors.name?.[0] ?? "");
          setDescriptionError(
            failure.response.data.fieldErrors.description?.[0] ?? "",
          );
          setError("Please check the highlighted fields.");
        } else
          setError(
            "We couldn’t confirm the changes. Refresh the categories before retrying.",
          );
      } else setError("We couldn’t save the category. Please try again.");
    } finally {
      running.current = false;
    }
  }
  return (
    <section
      className="category-editor"
      aria-labelledby="category-editor-title"
    >
      <p className="section-label">CATEGORY DETAILS</p>
      <h2 id="category-editor-title">Edit category</h2>
      <form
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={(event) => void submit(event)}
      >
        <div className="field">
          <label htmlFor="edit-category-name">Category name</label>
          <input
            ref={input}
            id="edit-category-name"
            required
            maxLength={CATEGORY_LIMITS.nameMax}
            value={name}
            disabled={mutation.isPending || unavailable}
            aria-invalid={Boolean(nameError)}
            aria-describedby={
              nameError ? "edit-category-name-error" : undefined
            }
            onChange={(event) => {
              setName(event.target.value);
              setNameError("");
              setError("");
            }}
          />
          {nameError && (
            <InlineMessage
              id="edit-category-name-error"
              className="field-error"
            >
              {nameError}
            </InlineMessage>
          )}
        </div>
        <div className="field">
          <label htmlFor="edit-category-description">
            Description <span className="field-hint">(optional)</span>
          </label>
          <textarea
            id="edit-category-description"
            rows={3}
            value={description}
            maxLength={CATEGORY_LIMITS.descriptionMax}
            disabled={mutation.isPending || unavailable}
            aria-invalid={Boolean(descriptionError)}
            aria-describedby={`category-description-hint${descriptionError ? " category-description-error" : ""}`}
            onChange={(event) => {
              setDescription(event.target.value);
              setDescriptionError("");
              setError("");
            }}
          />
          <p className="field-hint" id="category-description-hint">
            A short introduction, up to {CATEGORY_LIMITS.descriptionMax}{" "}
            characters.
          </p>
          {descriptionError && (
            <InlineMessage
              className="field-error"
              id="category-description-error"
            >
              {descriptionError}
            </InlineMessage>
          )}
        </div>
        <p className="categories-form-note">
          Menu address: <strong>/{category.slug}</strong>. Renaming keeps this
          address.
        </p>
        {error && <InlineMessage>{error}</InlineMessage>}
        <p className="field-hint" role="status">
          {mutation.isPending
            ? "Saving changes…"
            : dirty
              ? "Unsaved changes"
              : "No changes yet"}
        </p>
        <div className="category-editor-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={mutation.isPending || unavailable || !dirty}
          >
            {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              if (dirty) setDiscard(true);
              else onClose();
            }}
          >
            Cancel
          </button>
        </div>
      </form>
      <DecisionDialog
        open={discard}
        title="Discard category changes?"
        description="Your unsaved category details will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={onClose}
        onClose={() => setDiscard(false)}
      />
    </section>
  );
}
