import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

// Shadcn composition, with semantic native elements supported through Slot.
export function Card({ asChild = false, className, ...props }: ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return <Comp data-slot="card" className={cn("ui-card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("ui-card-header", className)} {...props} />;
}
export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("ui-card-title", className)} {...props} />;
}
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("ui-card-description", className)} {...props} />;
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("ui-card-content", className)} {...props} />;
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("ui-card-footer", className)} {...props} />;
}
