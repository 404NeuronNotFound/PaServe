import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Adapted from shadcn/ui's Radix Button. See SHADCN-LICENSE.md.
const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "primary-button ui-button-default",
      secondary: "secondary-button ui-button-secondary",
      outline: "secondary-button ui-button-outline",
      ghost: "ui-button-ghost",
      segment: "ui-button-segment",
      destructive: "ui-button-destructive",
      link: "ui-button-link",
      unstyled: "ui-button-unstyled",
    },
    size: {
      default: "ui-button-size-default",
      sm: "ui-button-size-sm",
      lg: "ui-button-size-lg",
      icon: "ui-button-size-icon",
      inherit: "",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

// Links have navigation semantics, not native disabled-button behavior.
export type ButtonProps = Omit<ComponentProps<"button">, "disabled"> & VariantProps<typeof buttonVariants> & (
  { asChild: true; disabled?: never } | { asChild?: false; disabled?: boolean }
);

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)}
    {...(!asChild ? { type: type ?? "button" } : {})} {...props} />;
}
