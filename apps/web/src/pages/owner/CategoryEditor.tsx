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
import { FiLayers, FiX, FiCheck, FiLoader, FiLink } from "react-icons/fi";

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
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const node = dialog.current;
    node?.showModal();
    input.current?.focus();
    return () => {
      active.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
      node?.close();
      queueMicrotask(() =>
        document.getElementById(`category-edit-${category.id}`)?.focus(),
      );
    };
  }, [category.id]);
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
  function finishClose() {
    if (closeTimer.current) return;
    setClosing(true);
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    closeTimer.current = setTimeout(onClose, reduced ? 0 : 180);
  }
  function requestClose() {
    if (running.current || closing || discard) return;
    if (dirty) setDiscard(true);
    else finishClose();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || unavailable || closing || !dirty) return;
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
      finishClose();
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
    <>
      <dialog
        ref={dialog}
        className={`category-edit-dialog${closing ? " is-closing" : ""}`}
        aria-modal="true"
        aria-labelledby="category-modal-title"
        aria-describedby="category-modal-description"
        aria-busy={mutation.isPending}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <section
          className="category-editor"
          aria-labelledby="category-editor-title"
        >
          <header className="category-modal-heading">
            <span className="category-modal-icon">
              <FiLayers aria-hidden="true" />
            </span>
            <div>
              <p className="section-label">CATEGORY DETAILS</p>
              <h2 id="category-editor-title">
                <span id="category-modal-title">Edit category</span>
              </h2>
              <p id="category-modal-description">
                A little polish for <strong>{category.name}</strong>.
              </p>
            </div>
            <button
              className="secondary-button category-modal-close"
              type="button"
              aria-label="Close category editor"
              disabled={mutation.isPending || closing}
              onClick={requestClose}
            >
              <FiX aria-hidden="true" />
            </button>
          </header>
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
                autoComplete="off"
                disabled={mutation.isPending || unavailable || closing}
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
                rows={4}
                placeholder="What makes this part of your menu special?"
                value={description}
                maxLength={CATEGORY_LIMITS.descriptionMax}
                disabled={mutation.isPending || unavailable || closing}
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
                <span className="category-character-count">
                  {description.length}/{CATEGORY_LIMITS.descriptionMax}
                </span>
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
            <div className="category-address-note">
              <FiLink aria-hidden="true" />
              <div>
                <span>YOUR MENU ADDRESS</span>
                <strong>/{category.slug}</strong>
                <p>Renaming keeps this address.</p>
              </div>
            </div>
            {error && <InlineMessage>{error}</InlineMessage>}
            <footer className="category-modal-footer">
              <p className="field-hint category-edit-status" role="status">
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
                  disabled={
                    mutation.isPending || unavailable || closing || !dirty
                  }
                >
                  {mutation.isPending ? (
                    <FiLoader className="is-spinning" aria-hidden="true" />
                  ) : (
                    <FiCheck aria-hidden="true" />
                  )}
                  {mutation.isPending ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={mutation.isPending || closing}
                  onClick={requestClose}
                >
                  Cancel
                </button>
              </div>
            </footer>
          </form>
        </section>
      </dialog>
      <DecisionDialog
        open={discard}
        title="Discard category changes?"
        description="Your unsaved category details will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={finishClose}
        onClose={() => setDiscard(false)}
      />
    </>
  );
}
