import type { ComponentProps } from "react";
import { Badge } from "../ui/badge";
import { statusPresentation } from "./status-presentation";
import { cn } from "../../lib/utils";
import "./status.css";

export function StatusBadge({ state, children, className, ...props }: Omit<ComponentProps<typeof Badge>, "variant"> & { state: string }) {
  const { label, tone, Icon } = statusPresentation(state);
  return <Badge {...props} variant="outline" className={cn("paserve-status", className)}
    data-state={state} data-tone={tone}>
    <Icon aria-hidden="true" focusable="false" />{children ?? label}
  </Badge>;
}
