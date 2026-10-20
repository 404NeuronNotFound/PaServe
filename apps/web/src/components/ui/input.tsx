import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  const textLike = !["checkbox", "radio", "color", "file", "range", "hidden"].includes(type ?? "text");
  return <input data-slot="input" type={type} className={cn(textLike ? "ui-input" : "ui-native-input", className)} {...props} />;
}
