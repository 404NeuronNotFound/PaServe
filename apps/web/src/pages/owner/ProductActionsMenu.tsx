import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { FiMoreHorizontal } from "react-icons/fi";

export function ProductActionsMenu({
  name,
  disabled,
  children,
  id,
}: {
  id: string;
  name: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !ref.current?.contains(event.target)
      ) {
        ref.current?.removeAttribute("open");
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  function keys(event: KeyboardEvent<HTMLDetailsElement>) {
    const node = event.currentTarget;
    if (event.key === "Escape") {
      node.open = false;
      setExpanded(false);
      node.querySelector("summary")?.focus();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      disabled ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    const items = [
      ...node.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    if (!items.length) return;
    event.preventDefault();
    node.open = true;
    setExpanded(true);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (index + 1) % items.length
            : index < 0
              ? items.length - 1
              : (index - 1 + items.length) % items.length;
    queueMicrotask(() => {
      if (node.open && node.isConnected) items[next].focus();
    });
  }
  return (
    <details
      ref={ref}
      className="product-actions-menu"
      onKeyDown={keys}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          event.currentTarget.open = false;
          setExpanded(false);
        }
      }}
    >
      <summary
        id={id}
        className="secondary-button"
        aria-label={`More actions for ${name}`}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <FiMoreHorizontal aria-hidden="true" />
        <span>More</span>
      </summary>
      <div
        className="product-actions-panel"
        hidden={!expanded}
        aria-label={`Actions for ${name}`}
      >
        {children}
      </div>
    </details>
  );
}
