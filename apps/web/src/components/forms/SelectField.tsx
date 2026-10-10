import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FiCheck, FiChevronDown } from "react-icons/fi";
import "./select-field.css";

type Option = { value: string; label: string };
export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const selected = options.findIndex((option) => option.value === value);
  function show() {
    if (disabled || !options.length) return;
    setActive(Math.max(0, selected));
    setOpen(true);
  }
  function choose(index: number) {
    if (disabled || !options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    if (!open) {
      node.hidePopover?.();
      if (typeof node.showPopover !== "function") node.style.display = "none";
      return;
    }
    function position() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || !node) return;
      const height = Math.min(
        options.length * 48 + 16,
        280,
        window.innerHeight - 24,
      );
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 24);
      node.style.width = `${width}px`;
      node.style.maxHeight = `${height}px`;
      node.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      node.style.top = `${Math.max(12, Math.min(rect.bottom + height + 8 > window.innerHeight && rect.top > height ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12))}px`;
    }
    position();
    if (typeof node.showPopover === "function") node.showPopover();
    else node.style.display = "block";
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
      node.hidePopover?.();
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useLayoutEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);
  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      setActive(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else show();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now();
      search.current = {
        text:
          (now - search.current.time < 700 ? search.current.text : "") +
          event.key.toLocaleLowerCase(),
        time: now,
      };
      const index = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(search.current.text),
      );
      if (index >= 0) {
        setActive(index);
        setOpen(true);
      }
    }
  }
  return (
    <div className="select-field">
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className="select-field-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-options`}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={`${id}-value${describedBy ? ` ${describedBy}` : ""}`}
        disabled={disabled}
        onKeyDown={keys}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget as Node | null))
            setOpen(false);
        }}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span id={`${id}-value`}>
          {options[selected]?.label ?? "Choose an option"}
        </span>
        <FiChevronDown aria-hidden="true" />
      </button>
      <div
        ref={panel}
        id={`${id}-options`}
        role="listbox"
        aria-label={`${label} options`}
        popover="manual"
        hidden={!open}
        className="select-field-options"
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            id={`${id}-option-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            data-index={index}
            aria-selected={option.value === value}
            data-active={index === active}
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
            {option.value === value && <FiCheck aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
