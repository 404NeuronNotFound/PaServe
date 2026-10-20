import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";
export function PageHeader({ className, title, description, actions, headingId, children, ...props }:
  Omit<ComponentProps<"header">, "title"> & { title?: string; description?: ReactNode; actions?: ReactNode; headingId?: string }) {
  return <header data-slot="PageHeader" className={cn("page-header", className)} {...props}>
    {title && <div><h1 id={headingId}>{title}</h1>{description && <p>{description}</p>}</div>}
    {children}{actions}
  </header>;
}
