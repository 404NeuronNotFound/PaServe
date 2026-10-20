import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
export function OrderCard({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="OrderCard" className={cn("active-order-card", className)} {...props} />;
}
