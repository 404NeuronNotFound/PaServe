import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { FiX } from "react-icons/fi";
import { cn } from "../../lib/utils";
export const Sheet = Primitive.Root;
export const SheetTrigger = Primitive.Trigger;
export const SheetClose = Primitive.Close;
export const SheetTitle = Primitive.Title;
export const SheetDescription = Primitive.Description;
export function SheetContent({ className, portalContainer, side = "right", children, ...props }: ComponentProps<typeof Primitive.Content> & { side?: "left" | "right"; portalContainer?: HTMLElement }) {
  return <Primitive.Portal container={portalContainer}><Primitive.Overlay className="ui-modal-overlay" />
    <Primitive.Content className={cn("ui-sheet-content", `ui-sheet-${side}`, className)} {...props}>
      {children}<Primitive.Close className="ui-modal-close" aria-label="Close panel"><FiX aria-hidden="true" /></Primitive.Close>
    </Primitive.Content></Primitive.Portal>;
}
