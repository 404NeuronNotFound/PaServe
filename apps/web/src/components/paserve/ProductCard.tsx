import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";
export function ProductCard({ className, variant = "customer", ...props }: ComponentProps<"li"> & { variant?: "customer" | "management" }) {
  return <li data-slot="ProductCard" className={cn(variant === "customer" ? "menu-product-card" : "product-card", className)} {...props} />;
}
