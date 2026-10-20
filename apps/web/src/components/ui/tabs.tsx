import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";
export const Tabs = Primitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className={cn("ui-tabs-list", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger className={cn("ui-tabs-trigger", className)} {...props} />;
}
export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn("ui-tabs-content", className)} {...props} />;
}
