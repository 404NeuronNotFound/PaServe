import { useId, useRef, useState, type FormEvent } from "react";
import {
  OWNER_ORDER_SEARCH_MAX_LENGTH,
  normalizeOwnerOrderSearch,
} from "@paserve/contracts";
import { FiSearch, FiX } from "react-icons/fi";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

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
      <Label htmlFor={id}>Search orders</Label>
      <div className="owner-order-search-controls">
        <span className="owner-order-search-icon">
          <FiSearch aria-hidden="true" />
        </span>
        <Input
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
        <Button variant="outline" type="submit">
          <FiSearch aria-hidden="true" />
          Search
        </Button>
        {(search || draft) && (
          <Button
            variant="outline"
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
          </Button>
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
