import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
import { useFieldControl } from "../forms/field-context";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  const field = useFieldControl(props.id, props["aria-describedby"]);
  const textLike = !["checkbox", "radio", "color", "file", "range", "hidden"].includes(type ?? "text");
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(textLike ? "ui-input" : "ui-native-input", className)}
      {...field}
      {...props}
      required={field.required || props.required}
      aria-describedby={field["aria-describedby"] ?? props["aria-describedby"]}
      aria-invalid={field["aria-invalid"] || props["aria-invalid"]}
    />
  );
}
