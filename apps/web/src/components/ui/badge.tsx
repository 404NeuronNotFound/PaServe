import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva("ui-badge", {
  variants: { variant: {
    default: "ui-badge-default",
    outline: "ui-badge-outline",
    destructive: "ui-badge-destructive",
    brand: "ui-badge-brand",
  } },
  defaultVariants: { variant: "default" },
});
export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
