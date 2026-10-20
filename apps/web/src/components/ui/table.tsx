import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** A named, keyboard-focusable overflow region around a semantic table. */
export function Table({ className, scrollLabel, containerClassName, ...props }: ComponentProps<"table"> & {
  scrollLabel: string;
  containerClassName?: string;
}) {
  return <div data-slot="table-container" className={cn("ui-table-container", containerClassName)}
    role="region" aria-label={scrollLabel} tabIndex={0}>
    <table data-slot="table" className={cn("ui-table", className)} {...props} />
  </div>;
}
export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("ui-table-header", className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("ui-table-body", className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("ui-table-row", className)} {...props} />;
}
export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th data-slot="table-head" className={cn("ui-table-head", className)} {...props} />;
}
export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("ui-table-cell", className)} {...props} />;
}
export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("ui-table-caption", className)} {...props} />;
}
