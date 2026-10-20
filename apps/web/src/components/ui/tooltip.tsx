import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";
export const TooltipProvider = Primitive.Provider;
export const Tooltip = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;
export function TooltipContent({ className, portalContainer, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content> & { portalContainer?: HTMLElement }) {
  return <Primitive.Portal container={portalContainer}><Primitive.Content sideOffset={sideOffset} collisionPadding={12} className={cn("ui-tooltip-content", className)} {...props} /></Primitive.Portal>;
}
