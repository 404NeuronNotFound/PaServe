import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Group related row controls under a record-specific accessible name. */
export function RowActions({ label, className, ...props }: ComponentProps<"div"> & { label: string }) {
  return <div {...props} role="group" aria-label={label} className={cn("management-row-actions", className)} />;
}
