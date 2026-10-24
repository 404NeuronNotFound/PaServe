import type { ComponentProps } from "react";
import { FiSearch, FiX } from "react-icons/fi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import "./search-field.css";

export function SearchField({ id, label, value, onClear, clearLabel = "Clear search", className, ...props }:
  Omit<ComponentProps<typeof Input>, "id" | "type" | "className" | "value"> & {
    id: string; label: string; value: string; onClear: () => void;
    clearLabel?: string; className?: string;
  }) {
  return (
    <div className={cn("paserve-search-field", className)}>
      <FiSearch aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>{label}</label>
      <Input {...props} id={id} type="search" value={value} />
      {value && <Button variant="ghost" size="icon" type="button" aria-label={clearLabel}
        title={clearLabel} disabled={props.disabled} onClick={onClear}>
        <FiX aria-hidden="true" />
      </Button>}
    </div>
  );
}
