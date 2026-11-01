import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { FiX } from "react-icons/fi";
import { cn } from "../../lib/utils";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  className,
  portalContainer,
  closeDisabled = false,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  portalContainer?: HTMLElement;
  closeDisabled?: boolean;
}) {
  return (
    <Primitive.Portal container={portalContainer}>
      <Primitive.Overlay className="ui-modal-overlay" />
      <Primitive.Content
        className={cn("ui-dialog-content", className)}
        {...props}
      >
        {children}
        <Primitive.Close
          disabled={closeDisabled}
          className="ui-modal-close"
          aria-label="Close dialog"
        >
          <FiX aria-hidden="true" />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
