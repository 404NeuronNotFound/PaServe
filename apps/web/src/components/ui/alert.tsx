import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

export function Alert({ asChild = false, unstyled = false, variant = "default", className, role = "alert", ...props }:
  ComponentProps<"div"> & { asChild?: boolean; unstyled?: boolean; variant?: "default" | "destructive" }) {
  const Comp = asChild ? Slot : "div";
  return <Comp data-slot="alert" role={role} className={cn(!unstyled && ["ui-alert", `ui-alert-${variant}`], className)} {...props} />;
}
export function AlertTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="alert-title" className={cn("ui-alert-title", className)} {...props} />;
}
export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("ui-alert-description", className)} {...props} />;
}
