import { useId, useRef, useState, type FormEvent } from "react";
import {
  OWNER_ORDER_SEARCH_MAX_LENGTH,
  normalizeOwnerOrderSearch,
} from "@paserve/contracts";
import { FiSearch, FiX } from "react-icons/fi";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function OrderSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(search);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeOwnerOrderSearch(draft);
    if (normalized === null) {
      setError("Use at most 80 characters without control characters.");
      input.current?.focus();
      return;
    }
    setError("");
    setDraft(normalized);
    onSearch(normalized);
  }
  return (
    <form
      className="owner-order-search"
      role="search"
      aria-label="Search orders in this view"
      onSubmit={submit}
    >
      <label htmlFor={id}>Search orders</label>
      <div className="owner-order-search-controls">
        <span className="owner-order-search-icon">
          <FiSearch aria-hidden="true" />
        </span>
        <input
          ref={input}
          id={id}
          type="search"
          value={draft}
          maxLength={OWNER_ORDER_SEARCH_MAX_LENGTH}
          placeholder="Order number or table label"
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          aria-invalid={!!error}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
        <button className="secondary-button" type="submit">
          <FiSearch aria-hidden="true" />
          Search
        </button>
        {(search || draft) && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setDraft("");
              setError("");
              onSearch("");
              input.current?.focus();
            }}
          >
            <FiX aria-hidden="true" />
            Clear search
          </button>
        )}
      </div>
      <p id={`${id}-help`}>
        Search order numbers and saved table labels in this view.
      </p>
      {search && <p>Showing matches for “{search}”.</p>}
      {error && <InlineMessage id={`${id}-error`}>{error}</InlineMessage>}
    </form>
  );
}
