import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import "./ui.css";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="label" className={cn("ui-label", className)} {...props} />;
}
