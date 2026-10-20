import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import "./ui.css";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={cn("ui-input", className)} {...props} />;
}
