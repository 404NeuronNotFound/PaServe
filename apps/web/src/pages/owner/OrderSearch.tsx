import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const applied = useRef(search);
  function cancelPending() {
    clearTimeout(timer.current);
    timer.current = undefined;
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  function apply(value: string, immediate = false) {
    cancelPending();
    const normalized = normalizeOwnerOrderSearch(value);
    if (normalized === null) {
      setError("Use at most 80 characters without control characters.");
      return;
    }
    setError("");
    if (composing.current || normalized === applied.current) return;
    const commit = () => {
      applied.current = normalized;
      onSearch(normalized);
    };
    if (immediate || !normalized) commit();
    else timer.current = setTimeout(commit, 400);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (composing.current) return;
    const normalized = normalizeOwnerOrderSearch(draft);
    if (normalized === null) {
      setError("Use at most 80 characters without control characters.");
      input.current?.focus();
      return;
    }
    setError("");
    setDraft(normalized);
    apply(normalized, true);
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
            apply(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
            cancelPending();
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            apply(event.currentTarget.value);
          }}
        />
        {(search || draft) && (
          <Button
            variant="outline"
            type="button"
            aria-label="Clear search"
            size="icon"
            onClick={() => {
              setDraft("");
              setError("");
              composing.current = false;
              apply("", true);
              input.current?.focus();
            }}
          >
            <FiX aria-hidden="true" />
          </Button>
        )}
      </div>
      <p id={`${id}-help`}>
        Results update as you type. Press Enter to search immediately.
      </p>
      {search && <p>Showing matches for “{search}”.</p>}
      {error && <InlineMessage id={`${id}-error`}>{error}</InlineMessage>}
    </form>
  );
}
