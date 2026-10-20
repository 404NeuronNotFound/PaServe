import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/utils";
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export function DropdownMenuContent({ className, portalContainer, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content> & { portalContainer?: HTMLElement }) {
  return <Primitive.Portal container={portalContainer}><Primitive.Content sideOffset={sideOffset} collisionPadding={12} className={cn("ui-dropdown-content", className)} {...props} /></Primitive.Portal>;
}
export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn("ui-dropdown-item", className)} {...props} />;
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn("ui-dropdown-label", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("ui-dropdown-separator", className)} {...props} />;
}
